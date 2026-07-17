import type { OracleBridgeErrorCategory } from "./OracleBridgeProtocol";

/** Safe, user-facing message per error category. The raw Oracle `ORA-` text never reaches the UI. */
export function safeMessageForCategory(category: OracleBridgeErrorCategory): string {
  switch (category) {
    case "AUTHENTICATION_FAILED":
      return "Authentication failed. Check the username and password.";
    case "NETWORK_UNREACHABLE":
      return "Could not reach the database host. Check the host, port, and network.";
    case "SERVICE_NOT_FOUND":
      return "The database service or SID was not found. Check the service name/SID.";
    case "TLS_ERROR":
      return "A TLS/SSL error occurred. Check the TCPS port, wallet, and trust store.";
    case "WALLET_ERROR":
      return "The Oracle wallet could not be loaded. Check the wallet directory.";
    case "TIMEOUT":
      return "The operation timed out.";
    case "DRIVER_ERROR":
      return "The Oracle JDBC driver reported an error.";
    case "DRIVER_UNAVAILABLE":
      return "The bundled Oracle JDBC driver is not installed in this build.";
    case "SQL_POLICY_VIOLATION":
      return "Only read-only SELECT queries are allowed.";
    case "RESULT_LIMIT_EXCEEDED":
      return "The query result exceeded the configured limits.";
    case "INVALID_CONFIGURATION":
      return "The connection configuration is invalid.";
    case "MESSAGE_TOO_LARGE":
      return "The request or result was too large to process.";
    case "UNSUPPORTED_OPERATION":
      return "The bridge does not support this operation.";
    case "CANCELLED":
      return "The operation was cancelled.";
    case "UNKNOWN":
    default:
      return "An unexpected database error occurred.";
  }
}
