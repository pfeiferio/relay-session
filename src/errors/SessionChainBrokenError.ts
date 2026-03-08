import {SESSION_CHAIN_BROKEN_ERROR_REF_SYMBOL} from "./symbols.js";
import {SessionChainError} from "./SessionChainError.js";

export class SessionChainBrokenError extends SessionChainError {
  [SESSION_CHAIN_BROKEN_ERROR_REF_SYMBOL]: true = true;
}
