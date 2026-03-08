import {SESSION_CHAIN_ERROR_REF_SYMBOL} from "./symbols.js";

export class SessionChainError extends Error {
  [SESSION_CHAIN_ERROR_REF_SYMBOL]: true = true;
}
