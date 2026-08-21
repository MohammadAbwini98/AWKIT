/** Types for the plain-Node Program Status server's verifier-facing module API. */
import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";

export declare const server: Server;

export declare function setPortableBuildProcessFactoryForTests(
  factory: () => ChildProcess
): void;
