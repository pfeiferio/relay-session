import type {Session} from "../session/Session.js";

declare module 'express-serve-static-core' {
  interface Request {
    session: Session<any>
  }
}

export {}
