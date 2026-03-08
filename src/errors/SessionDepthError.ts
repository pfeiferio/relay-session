import {SessionChainError} from "./SessionChainError.js";
import {SESSION_CHAIN_DEPTH_ERROR_REF_SYMBOL} from "./symbols.js";

export class SessionDepthError extends SessionChainError {
  [SESSION_CHAIN_DEPTH_ERROR_REF_SYMBOL]: true = true;
}
