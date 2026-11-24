use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null_mut, NonNull};

const SE_FILE_OBJECT: u32 = 1;
const DACL_SECURITY_INFORMATION: u32 = 4;
const SDDL_REVISION_1: u32 = 1;

#[link(name = "Advapi32")]
unsafe extern "system" {
    fn GetNamedSecurityInfoW(
        name: *const u16,
        object_type: u32,
        information: u32,
        owner: *mut *mut c_void,
        group: *mut *mut c_void,
        dacl: *mut *mut c_void,
        sacl: *mut *mut c_void,
        descriptor: *mut *mut c_void,
    ) -> u32;
    fn ConvertSecurityDescriptorToStringSecurityDescriptorW(
        descriptor: *const c_void,
        revision: u32,
        information: u32,
        sddl: *mut *mut u16,
        length: *mut u32,
    ) -> i32;
}

#[link(name = "Kernel32")]
unsafe extern "system" {
    fn LocalFree(handle: *mut c_void) -> *mut c_void;
}

struct LocalBuffer<T>(NonNull<T>);

impl<T> Drop for LocalBuffer<T> {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns an allocation returned by the Win32 calls below.
        unsafe { LocalFree(self.0.as_ptr().cast()) };
    }
}

fn read_dacl(path: &Path) -> io::Result<String> {
    let mut name: Vec<u16> = path.as_os_str().encode_wide().collect();
    if name.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "ACL path contains NUL",
        ));
    }
    name.push(0);
    let mut descriptor = null_mut();
    // SAFETY: name is NUL-terminated and descriptor is an initialized out pointer.
    let status = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    let descriptor = LocalBuffer(
        NonNull::new(descriptor).ok_or_else(|| io::Error::other("Missing security descriptor"))?,
    );
    let mut sddl = null_mut();
    let mut length = 0;
    // SAFETY: descriptor remains alive and both outputs are writable.
    let result = unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            descriptor.0.as_ptr(),
            SDDL_REVISION_1,
            DACL_SECURITY_INFORMATION,
            &mut sddl,
            &mut length,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    let sddl =
        LocalBuffer(NonNull::new(sddl).ok_or_else(|| io::Error::other("Missing DACL text"))?);
    // SAFETY: Windows returned length UTF-16 units owned by sddl.
    let text = unsafe { std::slice::from_raw_parts(sddl.0.as_ptr(), length as usize) };
    String::from_utf16(text.strip_suffix(&[0]).unwrap_or(text))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub(super) fn verify_existing_acl(path: &Path, sid: &str) -> Result<(), String> {
    let sddl = read_dacl(path)
        .map_err(|error| format!("Could not read the ACL of {}: {error}", path.display()))?;
    verify_acl_policy(&sddl, sid)
}

fn verify_acl_policy(sddl: &str, sid: &str) -> Result<(), String> {
    let sddl = sddl.to_ascii_uppercase();
    let entries: Vec<&str> = sddl
        .split('(')
        .skip(1)
        .filter_map(|ace| ace.split(')').next())
        .collect();
    for ace in &entries {
        let fields: Vec<&str> = ace.split(';').collect();
        if fields.len() >= 6
            && matches!(fields[0], "A" | "OA" | "XA" | "ZA")
            && broad_acl_principal(fields[5])
        {
            return Err(
                "Существующий каталог имеет разрешение для общей группы; отказ без изменения ACL."
                    .into(),
            );
        }
    }
    let user = sid.to_ascii_uppercase();
    let user_denied = entries.iter().any(|ace| {
        let fields: Vec<&str> = ace.split(';').collect();
        fields.len() >= 6
            && matches!(fields[0], "D" | "OD" | "XD")
            && fields[5] == user
            && !fields[1]
                .as_bytes()
                .as_chunks::<2>()
                .0
                .iter()
                .any(|flag| flag == b"IO")
            && !matches!(fields[2], "" | "0X0")
    });
    if user_denied {
        return Err("The existing ACL denies access to the current user".into());
    }
    let has_full_user_access = entries.iter().any(|ace| {
        let fields: Vec<&str> = ace.split(';').collect();
        fields.len() >= 6
            && fields[0] == "A"
            && fields[5] == user
            && !fields[1]
                .as_bytes()
                .as_chunks::<2>()
                .0
                .iter()
                .any(|flag| flag == b"IO")
            && (fields[2] == "FA" || fields[2] == "0X1F01FF")
    });
    if !has_full_user_access {
        return Err("Не подтверждён полный доступ текущего пользователя к существующему каталогу; отказ без изменения ACL.".into());
    }
    Ok(())
}

fn broad_acl_principal(principal: &str) -> bool {
    [
        "S-1-1-0",
        "S-1-5-11",
        "S-1-5-32-545",
        "S-1-15-2-1",
        "S-1-15-2-2",
        // SDDL commonly abbreviates these well-known SIDs.
        "WD", // Everyone
        "AU", // Authenticated Users
        "BU", // Builtin Users
        "AC", // All Application Packages
    ]
    .contains(&principal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acl_rejects_well_known_groups_in_sid_and_sddl_alias_forms() {
        for principal in ["AU", "BU", "WD", "AC", "S-1-5-11", "S-1-1-0"] {
            assert!(broad_acl_principal(principal), "{principal}");
        }
        assert!(!broad_acl_principal("SY"));
        assert!(!broad_acl_principal("BA"));
    }

    #[test]
    fn acl_policy_rejects_direct_deny_and_inherit_only_user_grant() {
        let sid = "S-1-5-21-1-2-3-1001";
        assert!(verify_acl_policy(&format!("D:P(D;;WD;;;{sid})(A;;FA;;;{sid})"), sid).is_err());
        assert!(verify_acl_policy(&format!("D:P(A;OIIO;FA;;;{sid})"), sid).is_err());
        assert!(verify_acl_policy(&format!("D:P(A;OICI;FA;;;{sid})"), sid).is_ok());
    }
}
