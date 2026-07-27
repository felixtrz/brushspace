import {
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PanelDocument,
  PanelUI,
  Quaternion,
  RayInteractable,
  UIKitDocument,
  Vector3,
  createSystem,
} from "@iwsdk/core";
import type { Entity, Object3D } from "@iwsdk/core";
import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";

import {
  CollabState,
  OpenBrushAppState,
  OpenBrushScenePose,
  PersistenceState,
  SettingsState,
} from "../components/core.js";
import {
  COLLAB_PROTOCOL_VERSION,
  VISIBILITY_GUIDS_PER_MESSAGE,
  chunkControlPoints,
  collabPeerId,
  generateCollabCode,
  isValidCollabCode,
  parseCollabMessage,
  type CollabMessage,
} from "../collab/protocol.js";
import {
  networkWarningFor,
  probeNetwork,
  type NetworkProbeVerdict,
} from "../collab/network-probe.js";
import type { Quat, StrokeData, Vec3 } from "../types.js";
import {
  disposeBakedSketchGroup,
  loadBakedSketchGroup,
} from "../sketch/baked-sketch.js";
import { assetUrl } from "../app/asset-url.js";
import { clearUIKitInteractionStateExcept } from "../panels/uikit-interaction.js";
import { AudioFeedbackSystem } from "./audio-feedback-system.js";
import { SketchLibrarySystem } from "./sketch-library-system.js";
import { StrokeAuthoringSystem } from "./stroke-authoring-system.js";

type CollabPhase =
  | "idle"
  | "hosting"
  | "joining"
  | "connected"
  | "reconnecting";

// Whole-stroke progress + tip beacons, both self-healing, so modest rates
// read smoothly without stressing the data channel.
const PROGRESS_INTERVAL_SECONDS = 0.1;
const TIP_INTERVAL_SECONDS = 0.12;
const TIP_STALE_SECONDS = 2;
// The baked head asset is authored in decimeters, ~6.4 dm tall and facing
// -Z; 0.05 renders a ~32 cm bird head - readable without blocking the view.
const AVATAR_HEAD_SCALE = 0.05;
// Keepalive pings go out on a timer (not the render loop) so they survive
// rAF pauses — headset off, system menu, backgrounded tab. Silence on the
// wire this long therefore means the peer is genuinely unreachable, and even
// then it only triggers a RECONNECT attempt, never an instant goodbye.
const KEEPALIVE_INTERVAL_MS = 2000;
const PEER_SILENCE_TIMEOUT_SECONDS = 15;
// The guest re-dials the host's still-claimed code for about a minute.
const RECONNECT_ATTEMPTS = 15;
const RECONNECT_INTERVAL_SECONDS = 4;
const HOST_ID_RETRIES = 3;
// A first dial that hasn't opened by now never will (a blocked network takes
// ~15-30s to report ICE failure); fail with advice instead of spinning on
// "Joining..." forever. WebRTC not connecting on some networks is accepted -
// the job here is telling the user, not preventing it.
const JOIN_TIMEOUT_SECONDS = 30;
const CONNECT_FAILED_MESSAGE = "Could not connect - try another network";

/**
 * Two-user peer-to-peer collaboration, scoped to a sketch session. The host
 * claims brushspace-<code> at the PeerJS cloud broker; the guest dials the
 * code. Stroke data travels as a custom protocol (see openbrush/collab.ts)
 * over one reliable JSON data channel. Leaving the sketch (Home / New /
 * Load) tears the connection down; a peer dropping never removes strokes —
 * the survivor keeps the whole sketch and can save it.
 */
export class CollabSystem extends createSystem({
  appState: { required: [OpenBrushAppState, CollabState, SettingsState] },
  scenePoses: { required: [OpenBrushScenePose] },
}) {
  private phase: CollabPhase = "idle";
  private role: "none" | "host" | "guest" = "none";
  private peer?: Peer;
  private conn?: DataConnection;
  private code = "";
  private hostRetriesLeft = HOST_ID_RETRIES;
  /** Set by index.ts when the page loads with ?join=<code>. */
  autoJoinCode = "";

  // Progress-broadcast bookkeeping for the local in-progress stroke.
  private progressTimer = 0;
  private lastProgressGuid = "";
  private lastProgressPointCount = 0;
  private committedGuids = new Set<string>();
  // Incoming begin/points/end stroke transfers, keyed by stroke guid.
  private readonly assembling = new Map<
    string,
    { stroke: StrokeData; live: boolean }
  >();

  // Remote peer tip presence.
  private tipTimer = 0;
  private tipEntity?: Entity;
  private headEntity?: Entity;
  private headLoadStarted = false;
  private headTargetPosition = new Vector3();
  private headTargetQuaternion = new Quaternion();
  private headSeen = false;
  private tipTargetPosition = new Vector3();
  private tipTargetQuaternion = new Quaternion();
  private tipLastSeen = -Infinity;
  private clock = 0;

  // Snapshot streaming (guest side).
  private snapshotStrokesPending = 0;
  private recvCount = 0;
  private lastRecvClock = 0;
  private readonly recentOps: string[] = [];

  // Disruption recovery.
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private byeReceived = false;
  private reconnectAttemptsLeft = 0;
  private reconnectDelay = 0;
  private sameCodeRetriesLeft = 0;
  private connectedAtClock = -Infinity;

  // Join keypad panel.
  private keypadEntity?: Entity;
  private keypadDocument?: UIKitDocument;
  private appliedKeypadEntry: string | undefined;
  private appliedKeypadWarning: string | undefined;

  // Network preflight (see collab/network-probe.ts).
  private probeInFlight = false;
  private lastProbeVerdict?: NetworkProbeVerdict;
  private joinStartedClock = -Infinity;

  private readonly tempMatrix = new Matrix4();
  private readonly tempVector = new Vector3();
  private readonly tempQuaternion = new Quaternion();
  private readonly tempPoseQuaternion = new Quaternion();

  init() {
    // Localhost-only handle so a plain 2D browser tab (no XR input) can
    // exercise the collab path end to end in tests.
    if (globalThis.location?.hostname === "localhost") {
      (globalThis as Record<string, unknown>).__brushspaceCollab = this;
    }
    const authoring = this.world.getSystem(StrokeAuthoringSystem);
    if (authoring) {
      authoring.onLocalStrokesCommitted = (strokes) => {
        for (const stroke of strokes) {
          this.committedGuids.add(stroke.guid);
          this.sendCommittedStroke(stroke);
        }
      };
      authoring.onLocalStrokeVisibility = (guids, visible) => {
        // Mass erase/undo can carry more guids than one wire message allows.
        const all = [...guids];
        for (
          let start = 0;
          start < all.length;
          start += VISIBILITY_GUIDS_PER_MESSAGE
        ) {
          this.send({
            t: "visibility",
            guids: all.slice(start, start + VISIBILITY_GUIDS_PER_MESSAGE),
            visible,
          });
        }
      };
    }
  }

  update(delta: number) {
    this.clock += delta;
    const appState = this.getAppState();
    if (!appState) {
      return;
    }

    this.consumeAutoJoin(appState);

    // The connection lives inside a sketch session: leaving it disconnects.
    const mode = String(appState.getValue(OpenBrushAppState, "mode"));
    if (mode !== "ready" && this.phase !== "idle") {
      this.teardown("Left the sketch", "ended");
    }
    if (mode !== "ready" && this.isJoinPanelOpen(appState)) {
      this.closeJoinPanel();
    }

    this.syncKeypad(appState);
    this.updateRemoteTip(delta);
    this.stepReconnect(delta);

    if (
      this.phase === "joining" &&
      this.clock - this.joinStartedClock > JOIN_TIMEOUT_SECONDS
    ) {
      this.teardown(CONNECT_FAILED_MESSAGE, "error");
    }

    if (this.phase !== "connected") {
      return;
    }
    if (this.clock - this.lastRecvClock > PEER_SILENCE_TIMEOUT_SECONDS) {
      console.log("[Collab] peer silent too long - attempting reconnect");
      this.handleConnectionLost();
      return;
    }
    this.broadcastStrokeProgress(delta);
    this.broadcastTip(delta);
  }

  /** Recovery loop: the guest re-dials, the host re-claims its code. */
  private stepReconnect(delta: number): void {
    if (this.phase !== "reconnecting") {
      return;
    }
    this.reconnectDelay -= delta;
    if (this.reconnectDelay > 0) {
      return;
    }
    this.reconnectDelay = RECONNECT_INTERVAL_SECONDS;
    if (this.reconnectAttemptsLeft <= 0) {
      this.finalPeerGone();
      return;
    }
    this.reconnectAttemptsLeft -= 1;
    if (this.role === "host") {
      // Re-claim the SAME code so the guest's re-dial still matches.
      console.log("[Collab] re-claiming code", this.code);
      this.peer?.destroy();
      this.peer = undefined;
      this.startHosting(this.code);
      return;
    }
    this.setStatus(
      "reconnecting",
      `Connection lost - reconnecting (${RECONNECT_ATTEMPTS - this.reconnectAttemptsLeft}/${RECONNECT_ATTEMPTS})`,
    );
    this.dialHost();
  }

  /**
   * The wire went quiet or the channel died without a goodbye. Keep every
   * stroke, then recover: the host keeps its code claimed at the broker and
   * waits; the guest re-dials that code until it answers or retries run out.
   */
  private handleConnectionLost(): void {
    this.stopKeepalive();
    const conn = this.conn;
    this.conn = undefined;
    try {
      conn?.close();
    } catch {
      // Already dead.
    }
    this.world.getSystem(StrokeAuthoringSystem)?.clearRemoteActiveStrokes();
    this.assembling.clear();
    if (this.clock - this.connectedAtClock >= RECONNECT_INTERVAL_SECONDS) {
      // A fresh disruption gets a full retry budget; a connection that died
      // within seconds of opening is a recovery that isn't sticking — keep
      // burning the existing budget so it can't loop forever.
      this.reconnectAttemptsLeft = RECONNECT_ATTEMPTS;
      this.sameCodeRetriesLeft = RECONNECT_ATTEMPTS;
    }
    if (this.role === "host") {
      if (this.peer && !this.peer.destroyed && !this.peer.disconnected) {
        // Broker registration survived: just wait for the guest to re-dial.
        this.phase = "hosting";
        this.setStatus(
          "hosting",
          `Connection lost - code ${this.code} still active`,
        );
      } else {
        // Broker registration died too; re-claim the same code (retried by
        // stepReconnect until the broker lets go of the zombie id).
        this.phase = "reconnecting";
        this.reconnectDelay = 0;
        this.setStatus(
          "reconnecting",
          `Connection lost - restoring code ${this.code}`,
        );
      }
      return;
    }
    this.phase = "reconnecting";
    this.reconnectDelay = 1;
    this.setStatus("reconnecting", "Connection lost - reconnecting...");
  }

  /** One reconnect dial: fresh peer, connect to the host's code. */
  private dialHost(): void {
    this.peer?.destroy();
    const peer = new Peer();
    this.peer = peer;
    peer.on("open", () => {
      if (this.peer !== peer || this.phase !== "reconnecting") {
        return;
      }
      const conn = peer.connect(collabPeerId(this.code), {
        reliable: true,
        serialization: "json",
      });
      this.adoptConnection(conn);
    });
    peer.on("error", (error) => this.onPeerError(peer, error));
  }

  /** Retries exhausted (or explicit goodbye): the sketch stays with us. */
  private finalPeerGone(): void {
    this.world.getSystem(AudioFeedbackSystem)?.playSound("peer-left");
    this.teardown(
      this.role === "guest"
        ? "Host left - the sketch is yours to keep"
        : "Peer left",
      "ended",
    );
  }

  // -------------------------------------------------------------------------
  // Public entry points (tools panel / URL)
  // -------------------------------------------------------------------------

  /** Share button: toggles hosting. */
  toggleHosting(): void {
    if (this.phase === "hosting") {
      this.teardown("Sharing stopped", "idle");
      return;
    }
    if (this.phase !== "idle") {
      return;
    }
    this.refreshNetworkWarning();
    this.hostRetriesLeft = HOST_ID_RETRIES;
    this.sameCodeRetriesLeft = 0;
    this.startHosting(generateCollabCode());
  }

  /** Join button: opens the keypad. */
  openJoinPanel(): void {
    if (this.phase !== "idle") {
      return;
    }
    this.refreshNetworkWarning();
    const appState = this.getAppState();
    appState?.setValue(CollabState, "joinPanelOpen", true);
    appState?.setValue(CollabState, "joinEntry", "");
    this.touch(appState);
  }

  closeJoinPanel(): void {
    const appState = this.getAppState();
    appState?.setValue(CollabState, "joinPanelOpen", false);
    appState?.setValue(CollabState, "joinEntry", "");
    this.touch(appState);
    this.disposeKeypad();
  }

  joinWithCode(code: string): void {
    if (!isValidCollabCode(code)) {
      this.setStatus("error", `Invalid code ${code}`);
      return;
    }
    if (this.phase !== "idle") {
      return;
    }
    this.closeJoinPanel();
    this.phase = "joining";
    this.role = "guest";
    this.code = code;
    this.joinStartedClock = this.clock;
    this.setStatus("joining", `Joining ${code}...`);

    const peer = new Peer();
    this.peer = peer;
    peer.on("open", () => {
      if (this.peer !== peer) {
        return;
      }
      const conn = peer.connect(collabPeerId(code), {
        reliable: true,
        serialization: "json",
      });
      this.adoptConnection(conn);
    });
    peer.on("error", (error) => this.onPeerError(peer, error));
  }

  // -------------------------------------------------------------------------
  // Hosting / joining internals
  // -------------------------------------------------------------------------

  private startHosting(code: string): void {
    this.phase = "hosting";
    this.role = "host";
    this.code = code;
    this.setStatus("hosting", `Code ${code} - waiting for a friend`);

    const peer = new Peer(collabPeerId(code));
    this.peer = peer;
    peer.on("open", () => {
      if (this.peer === peer) {
        this.sameCodeRetriesLeft = 0;
        this.setStatus(
          "hosting",
          this.lastProbeVerdict === "restricted"
            ? `Code ${code} - network may block connections`
            : `Code ${code} - share it!`,
        );
      }
    });
    peer.on("disconnected", () => {
      // Broker socket dropped (not the data channel). Re-register so the
      // code stays dialable.
      if (this.peer === peer && !peer.destroyed) {
        console.log("[Collab] broker connection lost - re-registering");
        try {
          peer.reconnect();
        } catch {
          // The recovery loop re-claims the code if this fails.
        }
      }
    });
    peer.on("connection", (conn) => {
      if (this.peer !== peer) {
        return;
      }
      if (this.conn?.open) {
        // One guest only; politely refuse extras.
        conn.on("open", () => conn.close());
        return;
      }
      // A pending connection that never opened (e.g. an abandoned dial from
      // a reconnecting guest) must not wedge the slot — replace it.
      const stale = this.conn;
      this.conn = undefined;
      try {
        stale?.close();
      } catch {
        // Already dead.
      }
      this.adoptConnection(conn);
    });
    peer.on("error", (error) => this.onPeerError(peer, error));
  }

  private adoptConnection(conn: DataConnection): void {
    this.conn = conn;
    this.byeReceived = false;
    let opened = false;
    conn.on("open", () => {
      console.log("[Collab] connection open, role:", this.role);
      if (this.conn !== conn) {
        return;
      }
      opened = true;
      this.phase = "connected";
      this.lastRecvClock = this.clock;
      this.connectedAtClock = this.clock;
      this.startKeepalive(conn);
      this.world.getSystem(AudioFeedbackSystem)?.playSound("connect");
      if (this.role === "guest") {
        conn.send({ t: "hello", version: COLLAB_PROTOCOL_VERSION });
        this.setStatus("connected", "Connected - syncing sketch");
      } else {
        this.setStatus("connected", `Connected - code ${this.code}`);
      }
      // Both sides sync their visible strokes: on first join the guest has
      // none, and after a reconnect this merges what either side drew while
      // apart (stroke GUIDs dedup the replays).
      this.sendSnapshot();
    });
    conn.on("data", (data) => {
      if (this.conn === conn) {
        this.onMessage(data);
      }
    });
    conn.on("close", () => {
      console.log("[Collab] connection closed");
      if (this.conn !== conn) {
        return;
      }
      if (!opened) {
        this.conn = undefined;
        if (this.phase === "joining") {
          // Defensive only: PeerJS 1.5.x never emits "close" for a
          // connection that hasn't opened (close() early-returns), so a
          // first dial dying in negotiation reaches us via the "error"
          // handler below - that one is the operative fail-fast path. Kept
          // in case a future PeerJS changes which event fires pre-open.
          this.teardown(CONNECT_FAILED_MESSAGE, "error");
        }
        // Otherwise it was an abandoned reconnect dial; the retry loop owns
        // the pacing.
        return;
      }
      if (this.byeReceived) {
        this.onPeerGone();
      } else {
        this.handleConnectionLost();
      }
    });
    conn.on("error", (error) => {
      console.warn("[Collab] connection error", error);
      if (this.conn !== conn) {
        return;
      }
      if (!opened) {
        this.conn = undefined;
        if (this.phase === "joining") {
          // The first dial died in negotiation (usually a network that
          // blocks WebRTC) - there is no retry loop yet, so surface it
          // instead of spinning on "Joining...". PeerJS reports pre-open
          // ICE/negotiation failure through this "error" event.
          this.teardown(CONNECT_FAILED_MESSAGE, "error");
        }
        return;
      }
      this.handleConnectionLost();
    });
  }

  private startKeepalive(conn: DataConnection): void {
    this.stopKeepalive();
    // setInterval keeps ticking while rAF is paused (headset off, system
    // menu), which is exactly when the peer must keep hearing from us.
    this.keepaliveTimer = setInterval(() => {
      if (this.conn !== conn || !conn.open) {
        this.stopKeepalive();
        return;
      }
      try {
        conn.send({ t: "ping" });
      } catch {
        // The close/error handlers own recovery.
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== undefined) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
  }

  private onPeerError(peer: Peer, error: Error & { type?: string }): void {
    if (this.peer !== peer) {
      return;
    }
    console.warn("[Collab] peer error:", error.type ?? error.message);
    if (error.type === "unavailable-id" && this.role === "host") {
      peer.destroy();
      this.peer = undefined;
      if (this.sameCodeRetriesLeft > 0) {
        // Recovering a session: the broker still holds our old (zombie)
        // registration; keep retrying the SAME code so the guest's re-dial
        // still matches.
        this.sameCodeRetriesLeft -= 1;
        this.phase = "reconnecting";
        return;
      }
      if (this.hostRetriesLeft > 0) {
        // Fresh share: someone else genuinely holds this code — roll a new one.
        this.hostRetriesLeft -= 1;
        this.startHosting(generateCollabCode());
      } else {
        this.teardown("Could not get a share code - try again", "error");
      }
      return;
    }
    if (this.phase === "reconnecting") {
      // Any dial failure (host not re-registered yet, broker hiccup) just
      // waits for the next retry tick.
      peer.destroy();
      return;
    }
    if (error.type === "peer-unavailable") {
      if (this.role === "guest" && this.phase === "joining") {
        // First dial to a code nobody holds: a genuine typo.
        this.teardown(`No sketch found for code ${this.code}`, "error");
      }
      // Otherwise it's a stale answer to a peer that already went away
      // (e.g. the guest's abandoned retry dialer) — never fatal.
      return;
    }
    if (this.phase === "connected") {
      // Signaling hiccups don't matter once the data channel is up.
      return;
    }
    if (this.role === "host") {
      // Never abandon an active share over broker trouble; keep the code
      // and let the recovery loop re-claim it.
      this.phase = "reconnecting";
      this.reconnectDelay = RECONNECT_INTERVAL_SECONDS;
      this.setStatus(
        "reconnecting",
        `Connection trouble - restoring code ${this.code}`,
      );
      return;
    }
    this.teardown("Connection failed - try again or switch network", "error");
  }

  /** The other side said goodbye on purpose: keep every stroke, go solo. */
  private onPeerGone(): void {
    this.stopKeepalive();
    const wasGuest = this.role === "guest";
    this.conn = undefined;
    if (this.role === "host" && this.peer && !this.peer.destroyed) {
      // Keep the room open for a new guest on the same code.
      this.phase = "hosting";
      this.setStatus(
        "hosting",
        `Guest left - code ${this.code} still active`,
      );
      this.world.getSystem(StrokeAuthoringSystem)?.clearRemoteActiveStrokes();
      this.assembling.clear();
      return;
    }
    this.teardown(
      wasGuest ? "Host left - the sketch is yours to keep" : "Peer left",
      "ended",
    );
  }

  private teardown(message: string, status: string): void {
    console.log("[Collab] teardown:", message);
    this.stopKeepalive();
    this.reconnectAttemptsLeft = 0;
    const conn = this.conn;
    this.conn = undefined;
    if (conn?.open) {
      try {
        conn.send({ t: "bye" });
        conn.close();
      } catch {
        // Best-effort goodbye.
      }
    }
    this.peer?.destroy();
    this.peer = undefined;
    this.phase = "idle";
    this.role = "none";
    this.code = "";
    this.snapshotStrokesPending = 0;
    this.lastProgressGuid = "";
    this.committedGuids.clear();
    this.world.getSystem(StrokeAuthoringSystem)?.clearRemoteActiveStrokes();
    this.assembling.clear();
    this.hideRemoteTip();
    this.setStatus(status, message);
  }

  // -------------------------------------------------------------------------
  // Wire protocol
  // -------------------------------------------------------------------------

  private send(message: CollabMessage): void {
    if (this.phase === "connected" && this.conn?.open) {
      this.conn.send(message);
    }
  }

  private sendSnapshot(): void {
    const library = this.world.getSystem(SketchLibrarySystem);
    const appState = this.getAppState();
    if (!library || !this.conn?.open) {
      return;
    }
    const strokes = library.collectVisibleStrokeData();
    const sketchName = appState
      ? String(appState.getValue(PersistenceState, "activeSketchName"))
      : "Shared Sketch";
    this.conn.send({
      t: "snapshot",
      version: COLLAB_PROTOCOL_VERSION,
      sketchName,
      strokeCount: strokes.length,
    });
    for (const stroke of strokes) {
      this.sendCommittedStroke(stroke);
    }
  }

  private onMessage(raw: unknown): void {
    this.recvCount += 1;
    this.lastRecvClock = this.clock;
    const message = parseCollabMessage(raw);
    if (!message) {
      console.warn("[Collab] dropped malformed message", raw);
      this.recentOps.push("malformed");
      return;
    }
    if (message.t !== "tip") {
      this.recentOps.push(message.t);
      if (this.recentOps.length > 20) {
        this.recentOps.shift();
      }
    }
    const authoring = this.world.getSystem(StrokeAuthoringSystem);
    switch (message.t) {
      case "hello":
        if (message.version !== COLLAB_PROTOCOL_VERSION) {
          this.teardown("Peer runs an incompatible version", "error");
        }
        break;
      case "snapshot": {
        if (message.version !== COLLAB_PROTOCOL_VERSION) {
          this.teardown("Peer runs an incompatible version", "error");
          break;
        }
        this.snapshotStrokesPending = message.strokeCount;
        if (this.role === "guest") {
          // Only the guest adopts the sketch name; the host's snapshot of a
          // reconnecting guest must not rename the host's sketch.
          this.world
            .getSystem(SketchLibrarySystem)
            ?.adoptCollabSketchName(message.sketchName);
        }
        this.setStatus("connected", `Connected - code ${this.code}`);
        break;
      }
      case "stroke-begin":
        // Re-announcing a guid resets its assembly: a committed stroke
        // replaces its own live preview this way.
        this.assembling.set(message.stroke.guid, {
          stroke: { ...message.stroke, controlPoints: [] },
          live: message.live,
        });
        break;
      case "stroke-points": {
        const entry = this.assembling.get(message.guid);
        if (!entry) {
          // A transfer whose begin predates a reconnect; the snapshot
          // replays the whole stroke, so dropping this chunk is safe.
          break;
        }
        if (message.from !== entry.stroke.controlPoints.length) {
          console.warn(
            `[Collab] stroke ${message.guid} chunk gap (have ${entry.stroke.controlPoints.length}, got from=${message.from}) - dropping transfer`,
          );
          this.assembling.delete(message.guid);
          if (entry.live) {
            authoring?.dropRemoteStroke(message.guid);
          }
          break;
        }
        entry.stroke.controlPoints.push(...message.points);
        if (entry.live && entry.stroke.controlPoints.length >= 2) {
          authoring?.upsertRemoteStroke(entry.stroke);
        }
        break;
      }
      case "stroke-end": {
        const entry = this.assembling.get(message.guid);
        this.assembling.delete(message.guid);
        if (this.snapshotStrokesPending > 0) {
          this.snapshotStrokesPending -= 1;
        }
        if (!entry) {
          break;
        }
        if (entry.stroke.controlPoints.length !== message.totalPoints) {
          console.warn(
            `[Collab] stroke ${message.guid} incomplete (${entry.stroke.controlPoints.length}/${message.totalPoints}) - dropping`,
          );
          if (entry.live) {
            authoring?.dropRemoteStroke(message.guid);
          }
          break;
        }
        authoring?.finalizeRemoteStroke(entry.stroke);
        break;
      }
      case "stroke-drop":
        this.assembling.delete(message.guid);
        authoring?.dropRemoteStroke(message.guid);
        break;
      case "visibility": {
        const applied = authoring?.applyRemoteVisibility(
          message.guids,
          message.visible,
        );
        console.log(
          `[Collab] visibility(${message.visible}) for ${message.guids.length} guids applied to ${applied ?? "?"} strokes`,
        );
        break;
      }
      case "tip":
        this.tipTargetPosition.set(...message.position);
        this.tipTargetQuaternion.set(...message.orientation);
        this.tipLastSeen = this.clock;
        this.showRemoteTip();
        if (message.head) {
          this.headTargetPosition.set(...message.head.position);
          this.headTargetQuaternion.set(...message.head.orientation);
          this.headSeen = true;
          this.showRemoteHead();
        }
        break;
      case "ping":
        // Keepalive: receipt alone refreshed lastRecvClock.
        break;
      case "bye":
        this.byeReceived = true;
        this.onPeerGone();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Live broadcast
  // -------------------------------------------------------------------------

  private broadcastStrokeProgress(delta: number): void {
    this.progressTimer += delta;
    if (this.progressTimer < PROGRESS_INTERVAL_SECONDS) {
      return;
    }
    this.progressTimer = 0;
    const authoring = this.world.getSystem(StrokeAuthoringSystem);
    const active = authoring?.getActiveLocalStrokeData();

    if (!active) {
      // A stroke we broadcast progress for ended: if it never committed,
      // it was discarded — tell the peer to drop it.
      if (this.lastProgressGuid && !this.committedGuids.has(this.lastProgressGuid)) {
        this.send({ t: "stroke-drop", guid: this.lastProgressGuid });
      }
      this.lastProgressGuid = "";
      this.lastProgressPointCount = 0;
      if (this.committedGuids.size > 64) {
        this.committedGuids.clear();
      }
      return;
    }
    if (active.controlPoints.length < 2) {
      return;
    }
    if (
      active.guid === this.lastProgressGuid &&
      active.controlPoints.length === this.lastProgressPointCount
    ) {
      return;
    }
    // Deltas keep every wire message small no matter how long the stroke
    // gets (PeerJS kills JSON channels on ~16 KB messages).
    if (active.guid !== this.lastProgressGuid) {
      this.lastProgressGuid = active.guid;
      this.lastProgressPointCount = 0;
      this.send({
        t: "stroke-begin",
        stroke: { ...active, controlPoints: [] },
        live: true,
      });
    }
    this.sendStrokePointChunks(
      active.guid,
      this.lastProgressPointCount,
      active.controlPoints.slice(this.lastProgressPointCount),
    );
    this.lastProgressPointCount = active.controlPoints.length;
  }

  /** Streams a committed stroke as a begin/points/end sequence. */
  private sendCommittedStroke(stroke: StrokeData): void {
    this.send({
      t: "stroke-begin",
      stroke: { ...stroke, controlPoints: [] },
      live: false,
    });
    this.sendStrokePointChunks(stroke.guid, 0, stroke.controlPoints);
    this.send({
      t: "stroke-end",
      guid: stroke.guid,
      totalPoints: stroke.controlPoints.length,
    });
  }

  private sendStrokePointChunks(
    guid: string,
    from: number,
    points: StrokeData["controlPoints"],
  ): void {
    let offset = from;
    for (const chunk of chunkControlPoints(points)) {
      this.send({ t: "stroke-points", guid, from: offset, points: chunk });
      offset += chunk.length;
    }
  }

  private broadcastTip(delta: number): void {
    this.tipTimer += delta;
    if (this.tipTimer < TIP_INTERVAL_SECONDS) {
      return;
    }
    this.tipTimer = 0;
    const tip = this.getLocalTipObject();
    const poseObject = this.getScenePoseObject();
    if (!tip || !poseObject) {
      return;
    }
    // Publish in canvas space so each side's world-grab pose stays local.
    tip.getWorldPosition(this.tempVector);
    tip.getWorldQuaternion(this.tempQuaternion);
    this.tempMatrix.copy(poseObject.matrixWorld).invert();
    this.tempVector.applyMatrix4(this.tempMatrix);
    poseObject.getWorldQuaternion(this.tempPoseQuaternion).invert();
    this.tempQuaternion.premultiply(this.tempPoseQuaternion);
    const position = this.tempVector.toArray() as Vec3;
    const orientation = [
      this.tempQuaternion.x,
      this.tempQuaternion.y,
      this.tempQuaternion.z,
      this.tempQuaternion.w,
    ] as Quat;
    // The viewer's head pose drives the peer-side avatar (same canvas-space
    // convention; temps are free again once the tip arrays are built).
    this.world.camera.getWorldPosition(this.tempVector);
    this.world.camera.getWorldQuaternion(this.tempQuaternion);
    this.tempVector.applyMatrix4(this.tempMatrix);
    this.tempQuaternion.premultiply(this.tempPoseQuaternion);
    this.send({
      t: "tip",
      position,
      orientation,
      drawing: Boolean(this.lastProgressGuid),
      head: {
        position: this.tempVector.toArray() as Vec3,
        orientation: [
          this.tempQuaternion.x,
          this.tempQuaternion.y,
          this.tempQuaternion.z,
          this.tempQuaternion.w,
        ] as Quat,
      },
    });
  }

  private getLocalTipObject(): Object3D | undefined {
    const appState = this.getAppState();
    const dominant = appState
      ? String(appState.getValue(SettingsState, "dominantHand"))
      : "right";
    return (
      this.world.scene.getObjectByName(`OpenBrushTipAnchor_${dominant}`) ??
      undefined
    );
  }

  private getScenePoseObject(): Object3D | undefined {
    for (const entity of this.queries.scenePoses.entities) {
      return entity.object3D ?? undefined;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Remote tip visual
  // -------------------------------------------------------------------------

  private showRemoteTip(): void {
    if (this.tipEntity) {
      return;
    }
    for (const entity of this.queries.scenePoses.entities) {
      const mesh = new Mesh(
        new OctahedronGeometry(0.012),
        new MeshBasicMaterial({ color: 0x63d0ff }),
      );
      mesh.name = "BrushspacePeerTip";
      mesh.raycast = () => {};
      const tipEntity = this.world.createTransformEntity(mesh, entity);
      tipEntity.object3D!.name = "BrushspacePeerTipEntity";
      this.tipEntity = tipEntity;
      return;
    }
  }

  private hideRemoteTip(): void {
    this.tipEntity?.dispose();
    this.tipEntity = undefined;
    this.tipLastSeen = -Infinity;
    const headGroup = this.headEntity?.object3D;
    if (headGroup) {
      disposeBakedSketchGroup(headGroup);
    }
    this.headEntity?.destroy();
    this.headEntity = undefined;
    this.headLoadStarted = false;
    this.headSeen = false;
  }

  /** The peer's avatar: the intro bird's head, tracking their headset. */
  private showRemoteHead(): void {
    if (this.headEntity || this.headLoadStarted) {
      return;
    }
    this.headLoadStarted = true;
    void loadBakedSketchGroup(
      assetUrl("/openbrush/avatar/head.json"),
      assetUrl("/openbrush/avatar/head.bin"),
      "BrushspacePeerHead",
    ).then((group) => {
      // The connection may have ended (or restarted the visual) mid-load.
      if (!group || !this.headLoadStarted || this.headEntity) {
        return;
      }
      for (const entity of this.queries.scenePoses.entities) {
        group.scale.setScalar(AVATAR_HEAD_SCALE);
        group.position.copy(this.headTargetPosition);
        group.quaternion.copy(this.headTargetQuaternion);
        const headEntity = this.world.createTransformEntity(group, entity);
        headEntity.object3D!.name = "BrushspacePeerHeadEntity";
        this.headEntity = headEntity;
        return;
      }
    });
  }

  private updateRemoteTip(delta: number): void {
    const tip = this.tipEntity?.object3D;
    if (!tip) {
      return;
    }
    if (this.clock - this.tipLastSeen > TIP_STALE_SECONDS) {
      tip.visible = false;
      const staleHead = this.headEntity?.object3D;
      if (staleHead) {
        staleHead.visible = false;
      }
      return;
    }
    tip.visible = true;
    const alpha = Math.min(1, delta * 12);
    tip.position.lerp(this.tipTargetPosition, alpha);
    tip.quaternion.slerp(this.tipTargetQuaternion, alpha);
    const head = this.headEntity?.object3D;
    if (head) {
      head.visible = this.headSeen && this.clock - this.tipLastSeen <= TIP_STALE_SECONDS;
      if (head.visible) {
        head.position.lerp(this.headTargetPosition, alpha);
        head.quaternion.slerp(this.headTargetQuaternion, alpha);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Network preflight
  // -------------------------------------------------------------------------

  /**
   * Kick (or re-kick) the ICE probe and push the current warning into
   * CollabState for the join panel. Runs on every Share/Join press so that
   * switching networks - exactly what the warning suggests - gets a fresh
   * verdict. The verdict only informs; it never blocks connecting.
   */
  private refreshNetworkWarning(): void {
    this.applyNetworkWarning();
    if (this.probeInFlight) {
      return;
    }
    this.probeInFlight = true;
    void probeNetwork().then((verdict) => {
      this.probeInFlight = false;
      this.lastProbeVerdict = verdict;
      console.log("[Collab] network probe verdict:", verdict);
      this.applyNetworkWarning();
    });
  }

  private applyNetworkWarning(): void {
    const appState = this.getAppState();
    if (!appState) {
      return;
    }
    appState.setValue(
      CollabState,
      "networkWarning",
      networkWarningFor(this.lastProbeVerdict),
    );
    this.touch(appState);
    // A host sharing from a restricted network waits forever on a code no
    // guest can reach; fold the caveat into the status line it is watching
    // (and lift it again when a re-probe on a new network comes back clean).
    if (this.phase !== "hosting" || this.conn?.open) {
      return;
    }
    if (this.lastProbeVerdict === "restricted") {
      this.setStatus(
        "hosting",
        `Code ${this.code} - network may block connections`,
      );
    } else if (this.peer?.open) {
      this.setStatus("hosting", `Code ${this.code} - share it!`);
    }
  }

  // -------------------------------------------------------------------------
  // Join keypad panel
  // -------------------------------------------------------------------------

  private syncKeypad(appState: Entity): void {
    const open = this.isJoinPanelOpen(appState);
    if (open && !this.keypadEntity) {
      this.createKeypad(appState);
    }
    if (!open && this.keypadEntity) {
      this.disposeKeypad();
    }
    const entity = this.keypadEntity;
    if (!entity || !entity.hasComponent(PanelDocument)) {
      return;
    }
    const document = PanelDocument.data.document[entity.index] as UIKitDocument;
    if (!document) {
      return;
    }
    if (this.keypadDocument !== document) {
      this.keypadDocument = document;
      this.appliedKeypadEntry = undefined;
      this.appliedKeypadWarning = undefined;
      this.bindKeypad(document, appState);
    }
    const entry = String(appState.getValue(CollabState, "joinEntry"));
    if (entry !== this.appliedKeypadEntry) {
      this.appliedKeypadEntry = entry;
      const display = document.getElementById("join-entry") as {
        setProperties(properties: Record<string, unknown>): void;
      } | null;
      display?.setProperties({
        text: entry.padEnd(6, "·").split("").join(" "),
      });
    }
    const warning = String(appState.getValue(CollabState, "networkWarning"));
    if (warning !== this.appliedKeypadWarning) {
      this.appliedKeypadWarning = warning;
      const display = document.getElementById("join-warning") as {
        setProperties(properties: Record<string, unknown>): void;
      } | null;
      display?.setProperties({ text: warning });
    }
  }

  private createKeypad(appState: Entity): void {
    const dominant = String(appState.getValue(SettingsState, "dominantHand"));
    const hand = dominant === "left" ? "right" : "left";
    const grip =
      hand === "left"
        ? this.world.playerSpaceEntities.gripSpaces.left
        : this.world.playerSpaceEntities.gripSpaces.right;
    const entity = this.world
      .createTransformEntity(undefined, grip)
      .addComponent(PanelUI, {
        config: "./ui/collab-join.json",
        maxWidth: 0.2,
        maxHeight: 0.35,
      })
      .addComponent(RayInteractable);
    entity.object3D!.name = "BrushspaceJoinKeypad";
    entity.object3D!.position.set(0, 0.035, -0.13);
    entity.object3D!.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    this.keypadEntity = entity;
    this.keypadDocument = undefined;
  }

  private disposeKeypad(): void {
    this.keypadEntity?.dispose();
    this.keypadEntity = undefined;
    this.keypadDocument = undefined;
    this.appliedKeypadEntry = undefined;
    this.appliedKeypadWarning = undefined;
  }

  private bindKeypad(document: UIKitDocument, appState: Entity): void {
    const on = (id: string, handler: () => void) => {
      const element = document.getElementById(id) as {
        addEventListener(type: string, listener: () => void): void;
      } | null;
      element?.addEventListener("click", () => {
        clearUIKitInteractionStateExcept(document, element);
        this.world.getSystem(AudioFeedbackSystem)?.playSound("ui-click");
        handler();
      });
    };
    for (let digit = 0; digit <= 9; digit += 1) {
      on(`key-${digit}`, () => {
        const entry = String(appState.getValue(CollabState, "joinEntry"));
        if (entry.length < 6) {
          appState.setValue(CollabState, "joinEntry", entry + String(digit));
          this.touch(appState);
        }
      });
    }
    on("key-back", () => {
      const entry = String(appState.getValue(CollabState, "joinEntry"));
      appState.setValue(CollabState, "joinEntry", entry.slice(0, -1));
      this.touch(appState);
    });
    on("key-cancel", () => this.closeJoinPanel());
    on("key-join", () => {
      const entry = String(appState.getValue(CollabState, "joinEntry"));
      if (isValidCollabCode(entry)) {
        this.joinWithCode(entry);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Misc
  // -------------------------------------------------------------------------

  /** Dev/test helper: author a small local stroke and share it, as a real
   * finalized stroke would be. */
  debugCommitTestStroke(): string {
    const guid = `debug-${Math.random().toString(36).slice(2, 10)}`;
    const points = [];
    for (let index = 0; index < 12; index += 1) {
      points.push({
        position: [0.4 + index * 0.03, 1.2 + Math.sin(index * 0.6) * 0.08, -0.8] as Vec3,
        orientation: [0, 0, 0, 1] as Quat,
        pressure: 1,
        timestampMs: index * 16,
      });
    }
    const stroke = {
      color: [1, 0.6, 0.1, 1] as [number, number, number, number],
      brushGuid: "429ed64a-4e97-4466-84d3-145a861ef684",
      brushSize: 0.02,
      brushScale: 1,
      controlPoints: points,
      flags: 0,
      seed: 1,
      groupId: 0,
      guid,
      layerIndex: 0,
    };
    this.world.getSystem(StrokeAuthoringSystem)?.spawnStrokeFromData(stroke, true);
    this.committedGuids.add(guid);
    this.sendCommittedStroke(stroke);
    return guid;
  }

  /** Dev/test helper: current collab state summary. */
  debugState(): Record<string, unknown> {
    return {
      phase: this.phase,
      role: this.role,
      code: this.code,
      connected: Boolean(this.conn?.open),
      snapshotStrokesPending: this.snapshotStrokesPending,
      recvCount: this.recvCount,
      recentOps: [...this.recentOps],
    };
  }

  /** Dev/test helper: save the active sketch (2D tabs have no tools panel). */
  debugSaveActiveSketch(): void {
    this.world.getSystem(SketchLibrarySystem)?.saveActiveSketch();
  }

  /** Dev/test helper: enter a blank ready-mode sketch (2D tabs can then host). */
  debugEnterSketch(): void {
    this.world.getSystem(SketchLibrarySystem)?.prepareForCollabJoin();
  }

  private consumeAutoJoin(appState: Entity): void {
    if (!this.autoJoinCode) {
      return;
    }
    const code = this.autoJoinCode;
    this.autoJoinCode = "";
    if (!isValidCollabCode(code)) {
      return;
    }
    this.world.getSystem(SketchLibrarySystem)?.prepareForCollabJoin();
    this.joinWithCode(code);
  }

  private isJoinPanelOpen(appState: Entity): boolean {
    return Boolean(appState.getValue(CollabState, "joinPanelOpen"));
  }

  private setStatus(status: string, message: string): void {
    const appState = this.getAppState();
    if (!appState) {
      return;
    }
    appState.setValue(CollabState, "status", status);
    appState.setValue(CollabState, "role", this.role);
    appState.setValue(CollabState, "code", this.code);
    appState.setValue(CollabState, "message", message);
    this.touch(appState);
  }

  private touch(appState: Entity | undefined): void {
    if (!appState) {
      return;
    }
    appState.setValue(
      CollabState,
      "revision",
      Number(appState.getValue(CollabState, "revision")) + 1,
    );
  }

  private getAppState(): Entity | undefined {
    const next = this.queries.appState.entities.values().next();
    return next.done ? undefined : next.value;
  }
}

