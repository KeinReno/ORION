import { Module } from "@nestjs/common";
import { ContactReferenceReader } from "../contact-reference-reader.service";
import { ContactReferences } from "./contact-references";

/** Reference SDK only: no ContactsModule, controllers, cron or lifecycle side effects. */
@Module({ providers: [{ provide: ContactReferences, useClass: ContactReferenceReader }], exports: [ContactReferences] })
export class ContactReferencesModule {}
