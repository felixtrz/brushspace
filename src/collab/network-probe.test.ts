import { describe, expect, it } from "vitest";

import {
  NETWORK_WARNING_RESTRICTED,
  NETWORK_WARNING_UNCERTAIN,
  candidateTypeOf,
  isTraversalCandidate,
  networkWarningFor,
  probeNetwork,
  type ProbeCandidate,
  type ProbeConnection,
} from "./network-probe.js";

class FakeConnection implements ProbeConnection {
  onicecandidate:
    | ((event: { candidate: ProbeCandidate | null }) => void)
    | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  iceGatheringState = "new";
  closed = false;
  failOffer = false;

  createDataChannel(): unknown {
    return {};
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (this.failOffer) {
      throw new Error("offer failed");
    }
    return { type: "offer" };
  }

  async setLocalDescription(): Promise<void> {}

  close(): void {
    this.closed = true;
  }

  emit(candidate: ProbeCandidate | null): void {
    this.onicecandidate?.({ candidate });
  }

  completeGathering(): void {
    this.iceGatheringState = "complete";
    this.onicegatheringstatechange?.();
  }
}

describe("candidateTypeOf", () => {
  it("prefers the structured type field", () => {
    expect(candidateTypeOf({ type: "srflx" })).toBe("srflx");
  });

  it("parses the SDP attribute when type is missing", () => {
    expect(
      candidateTypeOf({
        candidate:
          "candidate:842163049 1 udp 1677729535 203.0.113.7 51472 typ srflx raddr 0.0.0.0 rport 0",
      }),
    ).toBe("srflx");
    expect(
      candidateTypeOf({
        candidate: "candidate:1 1 udp 2122260223 192.168.1.4 55555 typ host",
      }),
    ).toBe("host");
  });

  it("returns empty for unparseable candidates", () => {
    expect(candidateTypeOf({})).toBe("");
    expect(candidateTypeOf({ candidate: "garbage" })).toBe("");
  });
});

describe("isTraversalCandidate", () => {
  it("accepts srflx and relay only", () => {
    expect(isTraversalCandidate("srflx")).toBe(true);
    expect(isTraversalCandidate("relay")).toBe(true);
    expect(isTraversalCandidate("host")).toBe(false);
    expect(isTraversalCandidate("prflx")).toBe(false);
    expect(isTraversalCandidate("")).toBe(false);
  });
});

describe("networkWarningFor", () => {
  it("clears the warning only on a good verdict", () => {
    expect(networkWarningFor("good")).toBe("");
    expect(networkWarningFor("restricted")).toBe(NETWORK_WARNING_RESTRICTED);
    expect(networkWarningFor("unknown")).toBe(NETWORK_WARNING_UNCERTAIN);
    expect(networkWarningFor(undefined)).toBe(NETWORK_WARNING_UNCERTAIN);
  });
});

describe("probeNetwork", () => {
  it("reports good on a server-reflexive candidate", async () => {
    const fake = new FakeConnection();
    const promise = probeNetwork({ createConnection: () => fake });
    fake.emit({ type: "host" });
    fake.emit({ type: "srflx" });
    await expect(promise).resolves.toBe("good");
    expect(fake.closed).toBe(true);
  });

  it("reports good on a relay candidate parsed from SDP", async () => {
    const fake = new FakeConnection();
    const promise = probeNetwork({ createConnection: () => fake });
    fake.emit({
      candidate: "candidate:1 1 udp 41885439 198.51.100.9 3478 typ relay",
    });
    await expect(promise).resolves.toBe("good");
  });

  it("reports restricted when gathering ends with host candidates only", async () => {
    const fake = new FakeConnection();
    const promise = probeNetwork({ createConnection: () => fake });
    fake.emit({ type: "host" });
    fake.emit(null);
    await expect(promise).resolves.toBe("restricted");
    expect(fake.closed).toBe(true);
  });

  it("reports restricted when the gathering state completes quietly", async () => {
    const fake = new FakeConnection();
    const promise = probeNetwork({ createConnection: () => fake });
    fake.completeGathering();
    await expect(promise).resolves.toBe("restricted");
  });

  it("reports restricted when nothing answers before the timeout", async () => {
    const fake = new FakeConnection();
    await expect(
      probeNetwork({ createConnection: () => fake, timeoutMs: 10 }),
    ).resolves.toBe("restricted");
    expect(fake.closed).toBe(true);
  });

  it("keeps the first verdict when later signals arrive", async () => {
    const fake = new FakeConnection();
    const promise = probeNetwork({ createConnection: () => fake });
    fake.emit({ type: "srflx" });
    fake.completeGathering();
    fake.emit(null);
    await expect(promise).resolves.toBe("good");
  });

  it("reports unknown when the connection cannot be created", async () => {
    await expect(
      probeNetwork({
        createConnection: () => {
          throw new Error("no webrtc");
        },
      }),
    ).resolves.toBe("unknown");
  });

  it("reports unknown when the offer fails", async () => {
    const fake = new FakeConnection();
    fake.failOffer = true;
    await expect(
      probeNetwork({ createConnection: () => fake }),
    ).resolves.toBe("unknown");
    expect(fake.closed).toBe(true);
  });
});
