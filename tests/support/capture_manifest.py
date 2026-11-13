#!/usr/bin/env python
"""The shared coverage contract for capture tools -- what was observed, and what
the observation is allowed to claim.

    python capture_manifest.py <manifest.json>      # validate; exit 4 on problems

Three channels acquire the same page and they are not interchangeable: network
responses are structured and cheapest, the DOM is a rendered fallback, pixels
are the last resort. What they DO share is the shape of the claim afterwards --
a list of things observed, and an assertion about what that list covers. This
module is that shape, so a downstream reader can ask "is this range whole?" of
a pixel stitch and a response capture in the same words.

WHY THE CLAIM IS THE DANGEROUS HALF. A pile of captured artifacts always looks
complete: ten responses on disk read identically whether ten were all there
was, or whether ninety more went past before the recorder attached. Absence has
no shape. So this manifest has no notion of "not present" -- every candidate the
recorder considered gets a row carrying one of a closed set of dispositions,
and the coverage summary is DERIVED from those rows rather than asserted
alongside them. A tool cannot write "bounded" over a manifest that does not
support it, because it never writes coverage at all.

Coverage degrades to `unknown` on any of the following, and each is a hole the
recorder did not witness rather than a hole it found:

  * no observations at all -- indistinguishable from never having run
  * a row whose disposition is `unknown`
  * a row carrying a LOSS: content the client received and the recorder could
    not read, so the corpus is missing what the page actually got
  * a session attached AFTER navigation, where cache-loaded history is gone
  * a session that ended by disconnect or crash rather than by being closed

EXHAUSTION IS A SEPARATE AXIS. Bounded coverage says the observation list is
known; it does not say the range ended. Running out of scroll, or of patience,
is not evidence of reaching the end of a range -- only scoped terminal evidence
is (an empty page, a documented first message, a boundary the endpoint itself
reported). Observed and driven capture differ in who controls the scroll, NOT
in what proves a range complete, so `exhausted` stays "unknown" in both until
that evidence is recorded.

CREDENTIALS NEVER LAND HERE. The manifest is the artifact every future session
reads, so a captured request header would put a live token in front of all of
them. Credential-shaped KEYS are refused at record time. This is a shape check,
not a secret scanner: it cannot see a token stored under an innocent key, and
it deliberately does not read values, because message text that mentions a
token is content and must survive. The behavioural half -- never issuing a
request that carries one -- belongs to passive_boundary.py.
"""
from __future__ import annotations

import json
import os
import sys

SCHEMA_VERSION = 1
KIND = "capture_manifest"

# Closed vocabularies. Each exists so a reader never has to interpret a blank.
MODES = {"observed", "driven"}
CHANNELS = {"network", "dom", "pixels"}

# Every candidate the recorder considered gets exactly one of these. There is
# deliberately no value meaning "not kept, never mind" -- `skipped_out_of_scope`
# is a decision with a scope behind it, `failed` is an attempt that errored, and
# `observed_no_body` is the exchange happening with its payload unavailable.
# Dropping that last one instead of naming it is how a denominator shrinks
# without anyone noticing.
DISPOSITIONS = {
    "captured",
    "observed_no_body",
    "skipped_out_of_scope",
    "failed",
    "unknown",
}

# A row carrying this key (value: a short kind, e.g. "no_resource") is content
# that finished arriving and could not be read. `observed_no_body` alone stays a
# known outcome -- an over-cap body is a policy, like scope -- but a LOSS is
# corpus the capture was meant to hold and does not, so it degrades coverage to
# `unknown` with a counted reason. Measured 2026-09-13: 2199 unreadable bodies
# sat under a manifest reporting `bounded` with no reason at all.
LOSS_FIELD = "loss"

# A row carrying this key names an exchange that has NO body by protocol, so
# nothing was lost: a CORS preflight, a 204/205, a 304 revalidation whose body
# did not read. Counted in coverage, never a reason for `unknown`. The set is
# closed and exclusive with LOSS_FIELD, because an open "not really a loss" key
# is exactly how a recorder would launder a real unreadable body into bounded.
NO_BODY_FIELD = "no_body"
NO_BODY_KINDS = {"cors_preflight", "no_content", "not_modified"}


def no_body_problem(disposition, fields):
    """Why a row's no_body key is invalid, or None."""
    kind = fields.get(NO_BODY_FIELD)
    if kind is None:
        return None
    if kind not in NO_BODY_KINDS:
        return f"no_body must be one of {sorted(NO_BODY_KINDS)}, got {kind!r}"
    if disposition != "observed_no_body":
        return f"no_body belongs only to observed_no_body, not {disposition!r}"
    if fields.get(LOSS_FIELD):
        return "a row may not carry both no_body and loss: it either had content or it did not"
    return None

# A session that ended any other way left a hole nobody watched.
CLEAN_END_REASONS = {"closed"}

COVERAGE_BOUNDED = "bounded"
COVERAGE_UNKNOWN = "unknown"

# The keys to_dict() owns. A tool with existing downstream readers emits ONE
# file that is a superset -- its legacy keys plus these -- rather than a second
# file beside the old one, because two writers of the same rows is how the two
# views drift apart. Extras may add keys; they may never shadow these.
CONTRACT_KEYS = frozenset({
    "schema_version", "kind", "tool", "tool_version", "mode", "channel",
    "target", "sessions", "observations", "segments", "coverage",
})

# Substrings that make a key credential-shaped. Matched case-insensitively
# against KEYS only, at any depth.
_CREDENTIAL_KEY_MARKERS = (
    "authorization",
    "cookie",
    "token",
    "password",
    "secret",
    "api-key",
    "api_key",
    "apikey",
    "x-auth",
)


class ManifestError(ValueError):
    """A contract violation: refused at write time rather than validated later."""


class CredentialLeak(ManifestError):
    """A credential-shaped key reached a manifest row."""


def is_credential_key(key) -> bool:
    """Whether a key is credential-shaped. Writers strip such keys with this
    before a row is built; assert_no_credentials is the line behind them."""
    low = str(key).lower()
    return any(marker in low for marker in _CREDENTIAL_KEY_MARKERS)


def assert_no_credentials(obj, path="") -> None:
    """Refuse credential-shaped keys anywhere in a row's payload.

    Keys only. A value is content -- a message that says "he asked for the
    token again" is exactly the material these captures exist to preserve.
    """
    if isinstance(obj, dict):
        for k, v in obj.items():
            if is_credential_key(k):
                where = f"{path}.{k}" if path else str(k)
                raise CredentialLeak(
                    f"credential-shaped key '{where}' may not be recorded in a manifest"
                )
            assert_no_credentials(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            assert_no_credentials(v, f"{path}[{i}]")


class Manifest:
    """One capture run: its sessions, its observations, and what they cover."""

    def __init__(self, tool, mode, channel, target=None, tool_version=None, extras=None):
        if mode not in MODES:
            raise ManifestError(f"mode must be one of {sorted(MODES)}, got {mode!r}")
        if channel not in CHANNELS:
            raise ManifestError(f"channel must be one of {sorted(CHANNELS)}, got {channel!r}")
        if extras:
            assert_no_credentials(extras, "extras")
            clash = set(extras) & CONTRACT_KEYS
            if clash:
                raise ManifestError(
                    f"extras may not shadow contract key(s) {sorted(clash)}: the coverage "
                    "block is derived precisely so nothing can assert over it"
                )
        self.extras = dict(extras or {})
        self.tool = tool
        self.tool_version = tool_version
        self.mode = mode
        self.channel = channel
        self.target = target or {}
        self.sessions: list[dict] = []
        self.observations: list[dict] = []
        self.segments: list[dict] = []
        self.terminal_evidence: list[dict] = []

    # -- sessions ----------------------------------------------------------

    def _session(self, session_id):
        for s in self.sessions:
            if s["id"] == session_id:
                return s
        return None

    def open_session(self, session_id, *, started, attached_before_navigate=None, attach=None):
        """Begin a session.

        `attached_before_navigate` has no default on purpose. It is the one
        fact that decides whether cache-loaded history could have gone past
        unseen, and a default would let a caller inherit an answer it never
        checked. Stating it is cheap; assuming it is the whole failure.
        """
        if attached_before_navigate is None:
            raise ManifestError(
                "open_session requires attached_before_navigate: whether the recorder "
                "was listening before the page loaded decides what it could have missed"
            )
        if self._session(session_id):
            raise ManifestError(f"session {session_id!r} already open")
        s = {
            "id": session_id,
            "started": started,
            "ended": None,
            "end_reason": None,
            "attached_before_navigate": bool(attached_before_navigate),
            "attach": attach or {},
        }
        self.sessions.append(s)
        return s

    def close_session(self, session_id, *, ended, reason):
        s = self._session(session_id)
        if s is None:
            raise ManifestError(f"unknown session {session_id!r}")
        s["ended"] = ended
        s["end_reason"] = reason
        return s

    # -- rows --------------------------------------------------------------

    def record(self, *, session, ts, disposition, **fields):
        if disposition not in DISPOSITIONS:
            raise ManifestError(
                f"disposition must be one of {sorted(DISPOSITIONS)}, got {disposition!r}"
            )
        s = self._session(session)
        if s is None:
            raise ManifestError(f"unknown session {session!r}")
        if s["ended"] is not None:
            raise ManifestError(
                f"session {session!r} is closed; a row arriving after the end of a "
                "session belongs to a session that was never opened"
            )
        problem = no_body_problem(disposition, fields)
        if problem:
            raise ManifestError(problem)
        assert_no_credentials(fields)
        row = {"session": session, "ts": ts, "disposition": disposition}
        row.update(fields)
        self.observations.append(row)
        return row

    def add_segment(self, segment_id, *, session, joined_to=None, **fields):
        """A contiguous run of observations. `joined_to` names the segment this
        one provably continues; None means a hole precedes it."""
        if self._session(session) is None:
            raise ManifestError(f"unknown session {session!r}")
        if joined_to is not None:
            prior = next((g for g in self.segments if g["id"] == joined_to), None)
            if prior is None:
                raise ManifestError(f"joined_to references unknown segment {joined_to!r}")
            if prior["session"] != session:
                raise ManifestError(
                    "segments may not be joined across a session boundary: the gap "
                    "between two sessions is exactly the interval nothing observed"
                )
        seg = {"id": segment_id, "session": session, "joined_to": joined_to}
        seg.update(fields)
        self.segments.append(seg)
        return seg

    def note_terminal_evidence(self, *, scope, kind, detail=None):
        """Record proof that a scope ENDED -- not that capture stopped."""
        ev = {"scope": scope, "kind": kind, "detail": detail}
        self.terminal_evidence.append(ev)
        return ev

    # -- derivation --------------------------------------------------------

    def coverage(self) -> dict:
        reasons: list[str] = []
        counts: dict[str, int] = {}
        for row in self.observations:
            counts[row["disposition"]] = counts.get(row["disposition"], 0) + 1

        if not self.observations:
            reasons.append(
                "no observations: a manifest with no rows is the same shape as a "
                "recorder that never ran"
            )
        if counts.get("unknown"):
            reasons.append(f"{counts['unknown']} observation(s) with unknown disposition")
        losses: dict[str, int] = {}
        for row in self.observations:
            kind = row.get(LOSS_FIELD)
            if kind:
                losses[str(kind)] = losses.get(str(kind), 0) + 1
        no_body: dict[str, int] = {}
        for row in self.observations:
            kind = row.get(NO_BODY_FIELD)
            if kind:
                no_body[str(kind)] = no_body.get(str(kind), 0) + 1
        if losses:
            kinds = ", ".join(f"{k}: {v}" for k, v in sorted(losses.items()))
            reasons.append(
                f"{sum(losses.values())} observation(s) finished with content the "
                f"recorder could not read ({kinds}): the corpus is missing what the "
                "client received"
            )
        for s in self.sessions:
            if not s["attached_before_navigate"]:
                reasons.append(
                    f"session {s['id']}: attach happened after navigation, so anything "
                    "served from cache before it is unobservable"
                )
            if s["ended"] is not None and s["end_reason"] not in CLEAN_END_REASONS:
                reasons.append(
                    f"session {s['id']}: ended '{s['end_reason']}', an interval nothing witnessed"
                )

        unjoined = sum(
            1 for i, g in enumerate(self.segments) if i > 0 and g.get("joined_to") is None
        )
        state = COVERAGE_UNKNOWN if reasons else COVERAGE_BOUNDED

        if not self.terminal_evidence:
            exhausted = "unknown"
        elif state == COVERAGE_BOUNDED and unjoined == 0:
            exhausted = True
        else:
            exhausted = False

        return {
            "state": state,
            "reasons": reasons,
            "observations": counts,
            "observation_total": len(self.observations),
            "losses": losses,
            "no_body": no_body,
            "sessions": len(self.sessions),
            "segments": len(self.segments),
            "unjoined_segments": unjoined,
            "exhausted": exhausted,
            "exhaustion_evidence": list(self.terminal_evidence),
        }

    def to_dict(self) -> dict:
        # Extras go DOWN first so a contract key can never be overwritten even
        # if the constructor's guard is ever bypassed by assigning .extras.
        # The row lists are SNAPSHOT: to_dict runs on the main thread while the
        # recorder thread is still appending, and handing out the live list
        # makes the serialiser walk a sequence growing underneath it. An extra
        # that aliases one of them (scroll-capture's legacy `frames` view) is
        # pointed at the SAME snapshot, so the two views of the rows still
        # cannot drift apart inside one file -- which is what that aliasing
        # was for.
        snapshots = [(self.sessions, list(self.sessions)),
                     (self.observations, list(self.observations)),
                     (self.segments, list(self.segments))]
        sessions, observations, segments = (snap for _, snap in snapshots)
        out = dict(self.extras)
        for key, value in list(out.items()):
            for live, snap in snapshots:
                if value is live:
                    out[key] = snap
                    break
        out.update({
            "schema_version": SCHEMA_VERSION,
            "kind": KIND,
            "tool": self.tool,
            "tool_version": self.tool_version,
            "mode": self.mode,
            "channel": self.channel,
            "target": self.target,
            "sessions": sessions,
            "observations": observations,
            "segments": segments,
            "coverage": self.coverage(),
        })
        return out

    def write(self, path):
        """Write the manifest so that failing cannot destroy the last one.

        Serialised to a sibling temp file and moved into place, because the
        previous in-place write made every checkpoint conditional on the NEXT
        write finishing. Measured 2026-09-13: a 14,382-row capture ended with
        a 280-row manifest naming no bodies, while 521 body files sat on disk
        with nothing to say what they were -- the final write had begun over
        the good checkpoint and been cut off. os.replace is atomic on Windows
        and POSIX alike, so a reader sees the old file or the new one.
        """
        path = os.fspath(path)
        tmp = path + ".partial"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(self.to_dict(), fh, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except BaseException:
            # Including KeyboardInterrupt: a half-written temp file left beside
            # a good manifest is debris that reads like a second capture.
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def validate(obj: dict) -> list[str]:
    """Check a manifest read back from disk. Returns problems; empty == valid.

    This re-derives coverage rather than reading it, so a hand-edited or
    hand-written coverage block is caught: the summary is a function of the
    rows. The comparison covers `state`, `exhausted`, `observation_total` and
    `unjoined_segments` -- the fields a claim would be forged in -- and a
    mismatch on any of them means the rows and the summary no longer agree.
    """
    problems: list[str] = []
    if obj.get("kind") != KIND:
        problems.append(f"kind must be {KIND!r}")
    if obj.get("schema_version") != SCHEMA_VERSION:
        problems.append(
            f"schema_version {obj.get('schema_version')!r} != {SCHEMA_VERSION} "
            "(this reader cannot vouch for a manifest it does not know)"
        )
    if obj.get("mode") not in MODES:
        problems.append(f"mode {obj.get('mode')!r} is not one of {sorted(MODES)}")
    if obj.get("channel") not in CHANNELS:
        problems.append(f"channel {obj.get('channel')!r} is not one of {sorted(CHANNELS)}")

    sessions = obj.get("sessions") or []
    session_ids = {s.get("id") for s in sessions}
    for s in sessions:
        if "attached_before_navigate" not in s:
            problems.append(f"session {s.get('id')!r}: attached_before_navigate is unstated")

    rows = obj.get("observations") or []
    for i, row in enumerate(rows):
        if row.get("disposition") not in DISPOSITIONS:
            problems.append(f"observation {i}: disposition {row.get('disposition')!r} is not known")
        problem = no_body_problem(row.get("disposition"), row)
        if problem:
            problems.append(f"observation {i}: {problem}")
        if row.get("session") not in session_ids:
            problems.append(f"observation {i}: session {row.get('session')!r} was never opened")
    try:
        assert_no_credentials(rows)
    except CredentialLeak as exc:
        problems.append(str(exc))

    seg_ids = {g.get("id") for g in obj.get("segments") or []}
    for g in obj.get("segments") or []:
        j = g.get("joined_to")
        if j is not None and j not in seg_ids:
            problems.append(f"segment {g.get('id')!r}: joined_to {j!r} names no segment")

    # Re-derive and compare. Rebuilding from the rows is what makes the
    # coverage block unforgeable -- it is the one field nothing may assert.
    if not problems:
        try:
            rebuilt = Manifest(
                tool=obj.get("tool"), mode=obj["mode"], channel=obj["channel"]
            )
            rebuilt.sessions = sessions
            rebuilt.observations = rows
            rebuilt.segments = list(obj.get("segments") or [])
            rebuilt.terminal_evidence = list(
                (obj.get("coverage") or {}).get("exhaustion_evidence") or []
            )
            derived = rebuilt.coverage()
        except ManifestError as exc:
            problems.append(str(exc))
        else:
            claimed = obj.get("coverage") or {}
            for field in ("state", "exhausted", "observation_total", "unjoined_segments"):
                if claimed.get(field) != derived[field]:
                    problems.append(
                        f"coverage.{field} claims {claimed.get(field)!r} but the rows "
                        f"derive {derived[field]!r}"
                    )
            if derived["state"] == COVERAGE_UNKNOWN and not derived["reasons"]:
                problems.append("coverage is unknown with no reason given")
            if derived["state"] == COVERAGE_UNKNOWN:
                problems.extend(f"coverage unknown: {r}" for r in derived["reasons"])
    return problems


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as fh:
        obj = json.load(fh)
    problems = validate(obj)
    if not problems:
        cov = obj.get("coverage", {})
        print(
            f"ok - {cov.get('observation_total')} observation(s), coverage "
            f"{cov.get('state')}, exhausted {cov.get('exhausted')}"
        )
        return 0
    for p in problems:
        print(f"  {p}")
    return 4


if __name__ == "__main__":
    sys.exit(main(sys.argv))
