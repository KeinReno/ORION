import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { resolveJwtSecret } from "../common/jwt-secret";

export interface JwtPayload {
  sub: string;
  email: string;
  sid?: string;
}

export interface RequestUser {
  userId: string;
  email: string;
  sessionId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret()
    });
  }

  validate(payload: JwtPayload): RequestUser {
    return { userId: payload.sub, email: payload.email, sessionId: payload.sid };
  }
}
