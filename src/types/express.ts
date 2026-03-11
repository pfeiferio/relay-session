import type {Session} from "../session/Session.js";
import type {SessionData} from "./types.js";

declare module 'express-serve-static-core' {
  interface Request {
    session: Session<SessionData>
  }
}

export {}
