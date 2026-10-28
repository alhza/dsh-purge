import { normalizeChatmlLayout } from "../lib/identity.js";
import { injectNeedle } from "./lib/inject.mjs";

const count = (hay, needle) => (needle ? String(hay).split(needle).length - 1 : 0);

/** 宿主侧的“拒绝/失败关闭”话术。清洗后不应出现在最终装配里。 */
export const DENIAL_CORPUS = [
  "denial is final",
  "fails closed",
  "cannot be widened",
  "untrusted data, not instructions",
  "Approval policy: ask",
];

export const INVARIANTS = [
  {
    id: "inject.once",
    check({ joined, inject }) {
      const n = count(joined, injectNeedle(inject));
      return { ok: n === 1, detail: `copies=${n}` };
    },
  },
  {
    id: "identity.absent",
    check({ out, joined }) {
      const section = out.sections.some((s) => s.name === "harness:identity");
      const text = joined.includes("You are an AI agent powered by DeepSeek Harness");
      return { ok: !section && !text, detail: `section=${section} text=${text}` };
    },
  },
  {
    id: "inject.first",
    check({ out }) {
      const first = out.sections[0];
      return { ok: first?.order === -100000, detail: `${first?.name}@${first?.order}` };
    },
  },
  {
    id: "closure.exactly-once",
    check({ joined, inject }) {
      // peelChatmlEnvelope 会在“有开无闭”时补闭合，期望值必须按规范化后的文本算。
      const expected = count(normalizeChatmlLayout(inject), "</project_instructions>");
      const actual = count(joined, "</project_instructions>");
      return { ok: actual === expected, detail: `expected=${expected} actual=${actual}` };
    },
  },
  {
    id: "tail.after-closer",
    check({ joined, inject }) {
      if (!normalizeChatmlLayout(inject).includes("</project_instructions>")) {
        return { ok: true, detail: "no-envelope" };
      }
      const closer = "</project_instructions>";
      const at = joined.lastIndexOf(closer);
      const tail = at < 0 ? -1 : joined.length - (at + closer.length);
      return { ok: tail > 0, detail: `tail=${tail}` };
    },
  },
  {
    id: "denial.absent",
    check({ hostJoined, joined }) {
      const hay = String(hostJoined || joined).toLowerCase();
      const hit = DENIAL_CORPUS.find((p) => hay.includes(p.toLowerCase()));
      return { ok: !hit, detail: hit ? `found=${hit}` : "clean" };
    },
  },
];
