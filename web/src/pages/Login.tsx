import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../lib/api.ts";
import { qc } from "../lib/queries.ts";
import { Wordmark } from "../App.tsx";

export function Login({ passwordLogin }: { passwordLogin: boolean }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/login", { method: "POST", json: { password: pw } });
      await qc.invalidateQueries();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 opacity-40" aria-hidden>
        {Array.from({ length: 14 }).map((_, i) => {
          const colors = ["--color-signal", "--color-laurel", "--color-ember", "--color-iris", "--color-coral", "--color-amber"];
          return (
            <div
              key={i}
              className="anim-grow absolute h-[7px] rounded-full"
              style={{
                top: i * 12 - 84,
                left: `${(i * 37) % 70}%`,
                width: `${12 + ((i * 23) % 28)}%`,
                background: `var(${colors[i % colors.length]})`,
                opacity: 0.25 + ((i * 7) % 10) / 20,
                animationDelay: `${i * 60}ms`,
              }}
            />
          );
        })}
      </div>
      <form onSubmit={(e) => (e.preventDefault(), submit())} className="anim-rise panel relative w-full max-w-sm p-7 shadow-[0_40px_120px_-30px_rgb(0_0_0/.9)]">
        <Wordmark size="lg" />
        <p className="mt-3 text-[14px] text-ash">Your game journal is locked.</p>
        <label className="mt-6 block">
          <span className="mb-1.5 block text-[12px] font-medium text-ash">{passwordLogin ? "Password" : "API token"}</span>
          <div className="relative">
            <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="field pl-9" autoComplete="current-password" />
          </div>
        </label>
        {err && <p className="mt-2 text-[12.5px] text-coral">{err}</p>}
        <button type="submit" disabled={!pw || busy} className="btn btn-primary mt-5 h-10 w-full justify-center">
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
