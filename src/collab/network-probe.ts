/**
 * Preflight check for the WebRTC path a collab session will actually use.
 * A throwaway RTCPeerConnection gathers ICE candidates against the same
 * STUN/TURN servers as the PeerJS defaults, and the candidate types that
 * come back tell us what this network allows:
 *
 * - a server-reflexive (srflx) or relay candidate means UDP reaches the
 *   traversal servers - the peer link is very likely to work;
 * - only host candidates (or silence) by the time gathering settles means
 *   STUN/TURN are unreachable - corporate/hotel-style firewalls - and the
 *   dial will almost certainly fail.
 *
 * The probe can only vouch for THIS side of the call, so "good" never means
 * guaranteed: the other peer may still sit behind a hostile network. The
 * verdict therefore only picks which warning to show, never blocks joining.
 */

export type NetworkProbeVerdict = "good" | "restricted" | "unknown";

/** Mirrors the PeerJS 1.5.x default ICE configuration (util.defaultConfig). */
const PROBE_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
    username: "peerjs",
    credential: "peerjsp",
  },
];

// STUN answers arrive well under a second on a permissive network; a window
// this long without one is itself the "servers unreachable" signal.
const PROBE_TIMEOUT_MS = 5000;

/**
 * Soft caution while the network cannot be ruled good or bad. Also
 * hand-copied as the join panel's pre-bind placeholder text in
 * ui/collab-join.uikitml (#join-warning) - keep the two in sync.
 */
export const NETWORK_WARNING_UNCERTAIN =
  "Some networks (office or public Wi-Fi) block peer connections. If connecting fails, try home Wi-Fi or a phone hotspot.";

/** The probe found no STUN/TURN path - a connection will very likely fail. */
export const NETWORK_WARNING_RESTRICTED =
  "This network appears to block peer connections, so connecting will likely fail. Try home Wi-Fi or a phone hotspot.";

/** Warning line for a verdict; "" (no warning) only when the probe passed. */
export function networkWarningFor(
  verdict: NetworkProbeVerdict | undefined,
): string {
  if (verdict === "good") {
    return "";
  }
  if (verdict === "restricted") {
    return NETWORK_WARNING_RESTRICTED;
  }
  return NETWORK_WARNING_UNCERTAIN;
}

export interface ProbeCandidate {
  type?: string | null;
  candidate?: string | null;
}

/** The slice of RTCPeerConnection the probe touches (injectable in tests). */
export interface ProbeConnection {
  onicecandidate:
    | ((event: { candidate: ProbeCandidate | null }) => void)
    | null;
  onicegatheringstatechange: (() => void) | null;
  readonly iceGatheringState?: string;
  createDataChannel(label: string): unknown;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
}

/**
 * Candidate type ("host" | "srflx" | "relay" | ...), falling back to parsing
 * the SDP attribute for engines that leave the `type` field null.
 */
export function candidateTypeOf(candidate: ProbeCandidate): string {
  if (candidate.type) {
    return candidate.type;
  }
  const match = / typ ([a-z]+)/.exec(candidate.candidate ?? "");
  return match?.[1] ?? "";
}

/** srflx proves STUN works, relay proves TURN works - either can carry us. */
export function isTraversalCandidate(type: string): boolean {
  return type === "srflx" || type === "relay";
}

function createDefaultConnection(): ProbeConnection {
  if (typeof RTCPeerConnection === "undefined") {
    throw new Error("RTCPeerConnection unavailable");
  }
  // RTCPeerConnection fits how the probe uses it (the events it fires carry
  // a superset of ProbeCandidate), but the mutable handler properties are
  // invariant, so a direct assignment does not type-check.
  return new RTCPeerConnection({
    iceServers: PROBE_ICE_SERVERS,
  }) as unknown as ProbeConnection;
}

/**
 * Resolves with a verdict; never rejects. "unknown" means the probe itself
 * could not run (no WebRTC, offer failed) - treat as inconclusive, not bad.
 */
export function probeNetwork(
  options: {
    timeoutMs?: number;
    createConnection?: () => ProbeConnection;
  } = {},
): Promise<NetworkProbeVerdict> {
  let connection: ProbeConnection;
  try {
    connection = (options.createConnection ?? createDefaultConnection)();
  } catch {
    return Promise.resolve("unknown");
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (verdict: NetworkProbeVerdict) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        connection.close();
      } catch {
        // Already closed.
      }
      resolve(verdict);
    };
    const timer = setTimeout(
      () => finish("restricted"),
      options.timeoutMs ?? PROBE_TIMEOUT_MS,
    );
    connection.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate) {
        // End-of-candidates without a traversal hit.
        finish("restricted");
        return;
      }
      if (isTraversalCandidate(candidateTypeOf(candidate))) {
        finish("good");
      }
    };
    connection.onicegatheringstatechange = () => {
      if (connection.iceGatheringState === "complete") {
        finish("restricted");
      }
    };
    Promise.resolve()
      .then(() => {
        connection.createDataChannel("brushspace-network-probe");
        return connection.createOffer();
      })
      .then((offer) => connection.setLocalDescription(offer))
      .catch(() => finish("unknown"));
  });
}
