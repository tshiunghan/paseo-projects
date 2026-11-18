import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { openExternal } from "./web";
import { boardActionRpc, boardEditRpc, boardSectionRpc, inboxDoneRpc, inboxListRpc, tasksRpc, threadActionRpc, threadDetailRpc } from "../shared/tasks";

// The thread groups of `pp`, most urgent first.
const GROUPS = [
  { key: "waiting-on-you", label: "Waiting on you", color: "#dc2626" },
  { key: "ready-for-review", label: "Ready for review", color: "#8b5cf6" },
  { key: "landing", label: "Ready to merge", color: "#16a34a" },
  { key: "working", label: "Working", color: "#3b82f6" },
  { key: "idle", label: "Idle", color: "#94a3b8" },
  { key: "resolved", label: "Resolved", color: "#64748b" },
];

// The tabs, in HP's popup order.
const TABS = [
  { key: "threads", label: "Threads" }, { key: "tasks", label: "Tasks" }, { key: "inbox", label: "Inbox" },
  { key: "routines", label: "Routines" }, { key: "settings", label: "Settings" }, { key: "memory", label: "Memory" },
] as const;
type Tab = (typeof TABS)[number]["key"];
type Section = "tasks" | "routines" | "settings" | "memory";

type Thread = { project: string; id: string; title: string; group: string; profile: string; branch: string | null; pr: string | null; prState: string | null };
type Item = { project: string; id: string; kind: string; subject: string; summary: string };

/** A board button; busy and error text replace the toast HP shows in its footer. */
function Btn({ label, onPress, theme, primary, disabled }: { label: string; onPress: () => void; theme: PluginScreenProps["theme"]; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: primary ? theme.colors.accent : theme.colors.surface1, opacity: disabled ? 0.5 : 0.95, marginRight: 8, marginBottom: 8 }}
    >
      <Text style={{ color: primary ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function BoardScreen({ theme, layout }: PluginScreenProps) {
  const client = useQueryClient();
  const listThreads = useRpc(tasksRpc);
  const detailRpc = useRpc(threadDetailRpc);
  const actionRpc = useRpc(threadActionRpc);
  const inboxList = useRpc(inboxListRpc);
  const inboxDoneCall = useRpc(inboxDoneRpc);
  const [tab, setTab] = useState<Tab>("threads");
  const [open, setOpen] = useState<string | null>(null); // `project/id`

  const q = useQuery({ queryKey: ["pp-tasks"], queryFn: () => listThreads({}), refetchInterval: 5000 });
  const inboxQ = useQuery({ queryKey: ["pp-inbox"], queryFn: () => inboxList({}), refetchInterval: 5000 });
  const threads = q.data?.threads ?? [];
  const key = (t: Thread) => `${t.project}/${t.id}`;
  const selected = threads.find((t) => key(t) === open) ?? null;
  const detail = useQuery({ queryKey: ["pp-detail", open], queryFn: () => detailRpc({ project: open!.split("/")[0], id: open!.split("/")[1] }), enabled: Boolean(open) });
  const needsYou = threads.filter((t) => t.group === "waiting-on-you").length;

  const action = useMutation({
    mutationFn: (v: { project: string; id: string; action: "ack" | "restart" | "resolve" | "next"; line?: number }) => actionRpc(v),
    onSuccess: async (r) => { await client.invalidateQueries(); return r; },
  });
  const markDone = useMutation({
    mutationFn: (v: { project: string; ids: string[] }) => inboxDoneCall(v),
    onSuccess: () => client.invalidateQueries(),
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 } as const,
      scroll: { padding: layout.compact ? 12 : 20, gap: 16 } as const,
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, marginBottom: 12 },
      tab: { fontSize: 15, fontWeight: "600" as const, color: theme.colors.foreground, opacity: 0.45, marginRight: 16 },
      tabOn: { opacity: 1 },
      groupTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const, marginBottom: 6, opacity: 0.7 } as const,
      card: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 3 } as const,
      title: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const } as const,
      meta: { color: theme.colors.foreground, fontSize: 12, opacity: 0.6, marginTop: 4 } as const,
      mono: { color: theme.colors.foreground, fontSize: 11, fontFamily: "Menlo" as const, lineHeight: 16 } as const,
      empty: { color: theme.colors.foreground, opacity: 0.5, textAlign: "center" as const, paddingTop: 60 } as const,
      note: { color: theme.colors.accent, fontSize: 12, marginBottom: 8 } as const,
    }),
    [theme, layout.compact],
  );

  if (q.isLoading) return <View style={styles.screen}><Text style={styles.empty}>Loading…</Text></View>;

  const run = (a: "ack" | "restart" | "resolve", t: Thread) => action.mutate({ project: t.project, id: t.id, action: a });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <View style={[styles.row, { flexWrap: "wrap" as const }]}>
        {TABS.map((t) => {
          const count = t.key === "threads" ? ` (${threads.filter((x) => x.group !== "resolved").length})` : t.key === "inbox" ? ` (${inboxQ.data?.items.length ?? 0})` : "";
          return <Pressable key={t.key} accessibilityRole="tab" onPress={() => { setTab(t.key); setOpen(null); }}><Text style={[styles.tab, tab === t.key && styles.tabOn]}>{t.label}{count}</Text></Pressable>;
        })}
      </View>
      {action.isError && <Text style={styles.note}>{String((action.error as Error).message).slice(0, 200)}</Text>}
      {action.isSuccess && !action.isIdle && action.data && <Text style={styles.note}>{action.data.message.slice(0, 120)}</Text>}

      {tab !== "threads" && tab !== "inbox" ? (
        <SectionView section={tab} theme={theme} styles={styles} />
      ) : tab === "inbox" ? (
        <View>
          {(inboxQ.data?.items ?? []).length === 0 && <Text style={styles.empty}>Inbox is empty.</Text>}
          {(inboxQ.data?.items ?? []).map((i: Item) => (
            <View key={i.id} style={styles.card}>
              <Text style={styles.title}>{i.summary}</Text>
              <Text style={styles.meta}>{i.project} · [{i.kind}] {i.subject}</Text>
              <View style={{ flexDirection: "row", marginTop: 8 }}>
                <Btn label="Mark done" disabled={markDone.isPending} theme={theme} onPress={() => markDone.mutate({ project: i.project, ids: [i.id] })} />
              </View>
            </View>
          ))}
        </View>
      ) : !selected ? (
        <View>
          {threads.length === 0 && <Text style={styles.empty}>No threads yet.{"\n"}pp open &lt;slug&gt; starts the project's coordinator, which opens threads.</Text>}
          {GROUPS.map((g) => {
            const items = threads.filter((t) => t.group === g.key);
            if (items.length === 0) return null;
            return (
              <View key={g.key}>
                <Text style={styles.groupTitle}>{g.label} ({items.length})</Text>
                {items.map((t: Thread) => (
                  <Pressable key={key(t)} onPress={() => setOpen(key(t))} style={[styles.card, { borderLeftColor: g.color }]}>
                    <Text style={styles.title}>{t.title}</Text>
                    <Text style={styles.meta}>
                      {t.project} · {t.id} · {t.profile}
                      {t.branch ? ` · ${t.branch}` : ""}
                      {t.pr ? ` · PR ${t.prState ?? ""}` : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            );
          })}
        </View>
      ) : (
        <View>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" onPress={() => setOpen(null)}><Text style={[styles.tab, styles.tabOn]}>‹ Back</Text></Pressable>
            <Text style={[styles.tab, { opacity: 0.7 }]}>{needsYou > 0 ? (needsYou === 1 ? "1 thread needs you" : `${needsYou} threads need you`) : ""}</Text>
          </View>
          <Text style={styles.title}>{selected.title}</Text>
          <Text style={styles.meta}>{selected.project} · {selected.id} · {selected.profile}{selected.branch ? ` · ${selected.branch}` : ""}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" as const, marginTop: 10 }}>
            <Btn label="Ack report" theme={theme} disabled={action.isPending} onPress={() => run("ack", selected)} />
            <Btn label="Restart" theme={theme} disabled={action.isPending} onPress={() => run("restart", selected)} />
            <Btn label="Resolve" theme={theme} primary disabled={action.isPending} onPress={() => run("resolve", selected)} />
            {selected.pr ? <Btn label="Open PR" theme={theme} onPress={() => openExternal(selected.pr!)} /> : null}
          </View>
          {(detail.data?.next ?? []).length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.groupTitle}>Next (tap to forward to the thread)</Text>
              {(detail.data?.next ?? []).map((line, n) => (
                <Pressable key={n} style={styles.card} disabled={action.isPending} onPress={() => action.mutate({ project: selected.project, id: selected.id, action: "next", line: n + 1 })}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{n + 1}. {line}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={[styles.groupTitle, { marginTop: 12 }]}>Report</Text>
          <Text style={styles.mono}>{detail.data?.report?.slice(0, 8000) ?? "…"}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/** The tasks, routines, settings and memory tabs; a tapped row shows its notes, prompt or text. */
function SectionView({ section, theme, styles }: { section: Section; theme: PluginScreenProps["theme"]; styles: any }) {
  const client = useQueryClient();
  const load = useRpc(boardSectionRpc);
  const act = useRpc(boardActionRpc);
  const editRpc = useRpc(boardEditRpc);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pick, setPick] = useState("");
  const q = useQuery({ queryKey: ["pp-board", section], queryFn: () => load({ section }), refetchInterval: 10000 });
  const [shown, setShown] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (v: { project: string; kind: "task" | "routine"; action: "delegate" | "done" | "drop" | "toggle"; target: string }) => act(v),
    onSuccess: () => client.invalidateQueries({ queryKey: ["pp-board", section] }),
  });
  type Edit = { scope: "project" | "safety" | "profile" | "default"; target: string; key: string; value: string };
  const edit = useMutation({
    mutationFn: (v: Edit) => editRpc(v),
    onSuccess: () => { setEditing(null); client.invalidateQueries({ queryKey: ["pp-board", section] }); },
  });
  const data = q.data?.data;
  if (q.isError) return <Text style={styles.note}>{String((q.error as Error).message).slice(0, 200)}</Text>;
  if (!data) return <Text style={styles.empty}>Loading…</Text>;
  const text = { color: theme.colors.foreground, fontSize: 13 } as const;
  const toggle = (k: string) => setShown(shown === k ? null : k);
  const status = (
    <>
      {run.isError && <Text style={styles.note}>{String((run.error as Error).message).slice(0, 200)}</Text>}
      {run.isSuccess && <Text style={styles.note}>{run.data.message.slice(0, 120) || "sent"}</Text>}
      {edit.isError && <Text style={styles.note}>{String((edit.error as Error).message).slice(0, 200)}</Text>}
      {edit.isSuccess && <Text style={styles.note}>{edit.data.message.slice(0, 160) || "saved"}</Text>}
    </>
  );

  if (section === "tasks") {
    if (!data.length) return <Text style={styles.empty}>No tasks. Ask the coordinator to add one.</Text>;
    let last = "";
    return (
      <View>
        {status}
        {data.map((t: any, i: number) => {
          const head = `${t.project} · ${t.list}`;
          const k = `${t.project}/${t.title}`;
          const header = head !== last ? <Text style={[styles.groupTitle, { marginTop: i ? 8 : 0 }]}>{(last = head)}</Text> : null;
          return (
            <View key={`${k}-${i}`}>
              {header}
              <Pressable style={styles.card} onPress={() => toggle(k)}>
                <Text style={styles.title}>{t.title}{t.notes ? "  ≡" : ""}</Text>
                <Text style={styles.meta}>{[t.owner, t.thread].filter(Boolean).join(" · ") || "unassigned"}</Text>
                {shown === k && t.notes ? <Text style={[styles.mono, { marginTop: 8 }]}>{t.notes}</Text> : null}
                {shown === k && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap" as const, marginTop: 8 }}>
                    {!t.thread && <Btn label="Delegate" primary theme={theme} disabled={run.isPending} onPress={() => run.mutate({ project: t.project, kind: "task", action: "delegate", target: t.title })} />}
                    <Btn label="Done" theme={theme} disabled={run.isPending} onPress={() => run.mutate({ project: t.project, kind: "task", action: "done", target: t.title })} />
                    <Btn label="Drop" theme={theme} disabled={run.isPending} onPress={() => run.mutate({ project: t.project, kind: "task", action: "drop", target: t.title })} />
                  </View>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  }

  if (section === "routines") {
    if (!data.length) return <Text style={styles.empty}>No routines. Ask the coordinator to add one.</Text>;
    return (
      <View>
        {status}
        {data.map((r: any) => {
          const k = `${r.project}/${r.name}`;
          return (
            <Pressable key={k} style={[styles.card, { opacity: r.enabled || r.error ? 1 : 0.6 }]} onPress={() => toggle(k)}>
              <Text style={styles.title}>{r.project} · {r.name}</Text>
              {r.error
                ? <Text style={[styles.meta, { color: "#dc2626", opacity: 1 }]}>Config error: {r.error}</Text>
                : <Text style={styles.meta}>{r.when} · {r.enabled ? "on" : "off"}{r.command ? " · command" : ""}{r.last ? ` · ${r.last}` : ""}</Text>}
              {shown === k && !r.error && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.mono}>{r.command ? `$ ${r.command}\n\n` : ""}{r.prompt}</Text>
                  <View style={{ flexDirection: "row", marginTop: 8 }}>
                    <Btn label={r.enabled ? "Turn off" : "Turn on"} theme={theme} disabled={run.isPending} onPress={() => run.mutate({ project: r.project, kind: "routine", action: "toggle", target: r.name })} />
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  }

  if (section === "settings") {
    type Opt = { value: string; label: string };
    const ch = data.choices ?? { providers: [], repos: [] };
    const kindOf = (prov: string) => prov.split("/")[0];
    const modelOf = (prov: string) => prov.split("/").slice(1).join("/");
    const providerOf = (kind: string) => ch.providers.find((p: any) => p.kind === kind) ?? { kind, models: [], modes: [] };
    const profileNames: Opt[] = data.profiles.map((p: any) => ({ value: p.name, label: p.name }));
    const onOff: Opt[] = [{ value: "true", label: "on" }, { value: "false", label: "off" }];
    const inherit: Opt = { value: "default", label: "inherit" };
    const withCurrent = (opts: Opt[], cur: string) => (cur && !opts.some((o) => o.value === cur) ? [{ value: cur, label: cur }, ...opts] : opts);
    const input = { color: theme.colors.foreground, borderColor: theme.colors.surface1, borderWidth: 1, borderRadius: 6, padding: 6, fontSize: 13, marginVertical: 6 } as const;
    const chip = (o: Opt, on: boolean, onPress: () => void) => (
      <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={o.label} disabled={edit.isPending} onPress={onPress}
        style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, marginRight: 6, marginBottom: 6, backgroundColor: on ? theme.colors.accent : theme.colors.surface1, opacity: edit.isPending ? 0.5 : 1 }}>
        <Text style={{ fontSize: 12, color: on ? theme.colors.accentForeground : theme.colors.foreground }}>{o.label}</Text>
      </Pressable>
    );
    const chips = (opts: Opt[], cur: string, onPick: (v: string) => void) => (
      <View style={{ flexDirection: "row", flexWrap: "wrap" as const, marginTop: 6 }}>{opts.map((o) => chip(o, o.value === cur, () => onPick(o.value)))}</View>
    );
    // A row that opens on tap; `body` is what it shows open.
    const row = (k: string, label: string, shown: string, body: () => any, open?: () => void) => (
      <View key={k}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={() => { if (editing === k) setEditing(null); else { setEditing(k); open?.(); } }}>
          <Text style={styles.mono}>{label.padEnd(22)} {shown || "—"}  {editing === k ? "▾" : "▸"}</Text>
        </Pressable>
        {editing === k && <View style={{ marginBottom: 6 }}>{body()}</View>}
      </View>
    );
    // Choosing one option saves it at once.
    const choose = (e: Omit<Edit, "value">, label: string, shown: string, cur: string, opts: Opt[], hint = "") =>
      row(`${e.scope}/${e.target}/${e.key}`, label, shown, () => (<>{hint ? <Text style={styles.meta}>{hint}</Text> : null}{chips(withCurrent(opts, cur), cur, (v) => edit.mutate({ ...e, value: v }))}</>));
    // Free text has no options: a name, a goal, a description.
    const text = (e: Omit<Edit, "value">, label: string, cur: string) =>
      row(`${e.scope}/${e.target}/${e.key}`, label, cur, () => (
        <>
          <TextInput style={input} value={draft} onChangeText={setDraft} autoFocus multiline={e.key === "goal"} accessibilityLabel={label} />
          <View style={{ flexDirection: "row" }}>
            <Btn label="Save" primary theme={theme} disabled={edit.isPending} onPress={() => edit.mutate({ ...e, value: draft.trim() })} />
            <Btn label="Cancel" theme={theme} onPress={() => setEditing(null)} />
          </View>
        </>
      ), () => setDraft(cur));
    // Several profile names; saved with one button. Empty means any profile.
    const many = (e: Omit<Edit, "value">, label: string, shown: string, cur: string[]) => {
      const set = draft.split(" ").filter(Boolean);
      return row(`${e.scope}/${e.target}/${e.key}`, label, shown, () => (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap" as const, marginTop: 6 }}>
            {profileNames.map((o) => chip(o, set.includes(o.value), () => setDraft((set.includes(o.value) ? set.filter((x) => x !== o.value) : [...set, o.value]).join(" "))))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" as const }}>
            <Btn label={set.length ? `Allow these ${set.length}` : "Any profile"} primary theme={theme} disabled={edit.isPending} onPress={() => edit.mutate({ ...e, value: set.join(" ") })} />
            <Btn label="Inherit" theme={theme} disabled={edit.isPending} onPress={() => edit.mutate({ ...e, value: "default" })} />
          </View>
        </>
      ), () => setDraft(cur.join(" ")));
    };
    // Provider in two steps: the kind, then its model ("Default model": the kind alone).
    const providerPicker = (cur: string, onPick: (prov: string) => void) => {
      const kind = pick || kindOf(cur);
      const models: Opt[] = [{ value: "", label: "Default model" }, ...providerOf(kind).models.map((m: any) => ({ value: m.id, label: m.label }))];
      return (
        <>
          <Text style={styles.meta}>provider</Text>
          {chips(withCurrent(ch.providers.map((p: any) => ({ value: p.kind, label: p.kind })), kindOf(cur)), kind, setPick)}
          <Text style={styles.meta}>model</Text>
          {chips(kind === kindOf(cur) ? withCurrent(models, modelOf(cur)) : models, kind === kindOf(cur) ? modelOf(cur) : "\u0000", (m) => onPick(m ? `${kind}/${m}` : kind))}
        </>
      );
    };
    const safetyText = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : Array.isArray(v) ? v.join(" ") || "any" : v == null ? "any" : String(v));
    const SAFETY_OPTS: Record<string, Opt[]> = {
      yolo: [{ value: "on", label: "on" }, { value: "off", label: "off" }, inherit],
      routine_commands: [{ value: "on", label: "on" }, { value: "off", label: "off" }, inherit],
      start_threads: [{ value: "propose", label: "propose first" }, { value: "auto", label: "start directly" }, inherit],
    };
    const safetyCur = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : String(v ?? ""));
    const num = (ns: number[], zero = "") => ns.map((n) => ({ value: String(n), label: n === 0 && zero ? zero : String(n) }));
    const projectOpts = (k: string): Opt[] | null =>
      k.endsWith("_profile") ? profileNames
      : k === "max_parallel_threads" ? num([1, 2, 3, 4, 5, 6, 8, 10])
      : k === "auto_resolve_days" ? num([0, 1, 2, 3, 5, 7, 14, 30], "never")
      : k === "nudge" || k === "mute" || k === "pr_checks" ? onOff : null;
    return (
      <View>
        <Text style={styles.meta}>Tap a row to open it, tap a choice to save. Project settings apply at once; safety settings and profiles can only be changed by you — saving asks for a system dialog, and only Allow applies it.</Text>
        <Text style={[styles.groupTitle, { marginTop: 12 }]}>Default profiles for new projects</Text>
        <View style={styles.card}>
          {(["thread", "coordinator"] as const).map((r) => {
            const cur = data.defaults[`${r}_profile`] ?? "";
            return choose({ scope: "default", target: r, key: "profile" }, `${r}_profile`, cur || "claude", cur, profileNames);
          })}
        </View>
        <Text style={[styles.groupTitle, { marginTop: 8 }]}>Profiles</Text>
        {data.profiles.map((p: any) => {
          const e = (key: string) => ({ scope: "profile" as const, target: p.name, key });
          const model = providerOf(kindOf(p.provider)).models.find((m: any) => m.id === modelOf(p.provider));
          const thinking: Opt[] = [{ value: "", label: "Default" }, ...(model?.thinking ?? []).map((t: any) => ({ value: t.id, label: t.label }))];
          const modes: Opt[] = [{ value: "", label: "Default" }, ...providerOf(kindOf(p.provider)).modes.map((m: any) => ({ value: m.id, label: m.label }))];
          return (
            <View key={p.name} style={styles.card}>
              <Text style={styles.title}>{p.name}{p.builtin ? " (built in)" : ""}</Text>
              {p.builtin ? <Text style={styles.meta}>{p.summary}</Text> : (
                <>
                  {row(`profile/${p.name}/provider`, "provider", p.provider, () => providerPicker(p.provider, (v) => edit.mutate({ ...e("provider"), value: v })), () => setPick(""))}
                  {choose(e("thinking"), "thinking", p.thinking || "Default", p.thinking, thinking)}
                  {choose(e("mode"), "mode", p.mode || "Default", p.mode, modes)}
                  {choose(e("yolo_mode"), "yolo_mode", p.yolo_mode || "Default", p.yolo_mode, modes, "the mode used while yolo is on")}
                  {text(e("description"), "description", p.description)}
                  <View style={{ flexDirection: "row", marginTop: 6 }}>
                    <Btn label="Delete" theme={theme} disabled={edit.isPending} onPress={() => edit.mutate({ ...e("remove"), value: "" })} />
                  </View>
                </>
              )}
            </View>
          );
        })}
        <View style={styles.card}>
          {row("profile/_new/add", "New profile", "", () => (
            <>
              <TextInput style={input} value={draft} onChangeText={setDraft} placeholder="A name, e.g. reviewer" autoFocus accessibilityLabel="New profile name" />
              {providerPicker("", (prov) => edit.mutate({ scope: "profile", target: draft.trim(), key: "add", value: prov }))}
              <Text style={styles.meta}>It is created once you pick a model.</Text>
            </>
          ), () => { setDraft(""); setPick(ch.providers[0]?.kind ?? ""); })}
        </View>
        {data.projects.map((p: any) => {
          const repoPaths = p.settings.repos.map((r: string) => r.replace(/@[^/@]*$/, ""));
          const addable: Opt[] = ch.repos.filter((r: string) => !repoPaths.includes(r)).map((r: string) => ({ value: r, label: r.split("/").pop() || r }));
          return (
            <View key={p.project}>
              <Text style={[styles.groupTitle, { marginTop: 8 }]}>{p.project} · {p.status}</Text>
              <View style={styles.card}>
                {Object.entries(p.settings).filter(([k]) => k !== "repos").map(([k, v]) => {
                  const cur = v == null ? "" : String(v);
                  const e = { scope: "project" as const, target: p.project, key: k };
                  const opts = projectOpts(k);
                  const shown = opts?.find((o) => o.value === cur)?.label ?? cur;
                  return opts ? choose(e, k, shown, cur, opts, data.hints[k]) : text(e, k, cur);
                })}
                <Text style={[styles.meta, { marginTop: 6 }]}>repos</Text>
                {p.settings.repos.map((r: string, i: number) => (
                  <View key={r} style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={[styles.mono, { flex: 1 }]}>{r}</Text>
                    <Btn label="Remove" theme={theme} disabled={edit.isPending} onPress={() => edit.mutate({ scope: "project", target: p.project, key: "repos.remove", value: repoPaths[i] })} />
                  </View>
                ))}
                {row(`project/${p.project}/repos.add`, "Add repo", "", () => (addable.length
                  ? chips(addable, "", (v) => edit.mutate({ scope: "project", target: p.project, key: "repos.add", value: v }))
                  : <Text style={styles.meta}>Every repository Paseo knows is already added. Open another one in Paseo first, or run pp set … repos.add in a terminal.</Text>))}
                <Text style={[styles.meta, { marginTop: 6, marginBottom: 4 }]}>Safety settings (source in parentheses)</Text>
                {Object.entries(p.safety).map(([k, s]: [string, any]) => {
                  const e = { scope: "safety" as const, target: p.project, key: k };
                  const shown = `${safetyText(s.value)} (${s.source})`;
                  return SAFETY_OPTS[k] ? choose(e, k, shown, s.source === "project" ? safetyCur(s.value) : "", SAFETY_OPTS[k], s.hint) : many(e, k, shown, Array.isArray(s.value) ? s.value : []);
                })}
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.meta}>Read-only. To change memory, talk to the coordinator.</Text>
      {data.map((m: any) => {
        const k = `${m.project}/${m.file}`;
        return (
          <Pressable key={k} style={[styles.card, { marginTop: 8 }]} onPress={() => toggle(k)}>
            <Text style={styles.title}>{m.project} · {m.file}</Text>
            {shown === k ? <Text style={[styles.mono, { marginTop: 8 }]}>{m.text.slice(0, 20000) || "(empty)"}</Text> : <Text style={styles.meta}>{m.text.length} characters, tap to view</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}
