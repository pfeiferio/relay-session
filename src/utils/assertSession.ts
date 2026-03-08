import type {Session} from "../session/Session.js";

/**
 * Type assertion for session objects.
 * Intentionally empty — narrows the session type to Session<T> for TypeScript.
 * No runtime check needed; use only when you know the session type is correct.
 */
export function assertSession<T extends Record<string, unknown>>(_session: Session<T>): asserts _session is Session<T> {
}
