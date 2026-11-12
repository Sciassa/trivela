import type { NewspaperPage, PrimaPaginaSlot } from "@trivela/protocol";

/** Render text replacing {{0}}/{{1}} with censor bars or the revealed answer. */
function Fill({ text, slots, revealed }: { text: string; slots: PrimaPaginaSlot[]; revealed: boolean }) {
  const parts = text.split(/(\{\{\d\}\})/);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{\{(\d)\}\}$/);
        if (!m) return <span key={i}>{p}</span>;
        const k = Number(m[1]);
        const slot = slots[k];
        if (!slot) return null;
        if (revealed && slot.answer.display) {
          return (
            <mark key={i} className="revealed">
              {slot.answer.display}
            </mark>
          );
        }
        return (
          <span key={i} className={`redact b${slot.lengthBucket}`}>
            <span className="tag">{k + 1}</span>
          </span>
        );
      })}
    </>
  );
}

export function Newspaper({ page, slots, revealed }: { page: NewspaperPage; slots: PrimaPaginaSlot[]; revealed: boolean }) {
  return (
    <article className="paper" lang="it">
      <header className="masthead">
        <h1>{page.masthead}</h1>
      </header>
      <div className="dateline">
        <span>{page.weekday}</span>
        <span>{page.date}</span>
        <span>Edizione speciale</span>
      </div>
      <div className="kicker">
        <Fill text={page.kicker} slots={slots} revealed={revealed} />
      </div>
      <h2 className="headline">
        <Fill text={page.headline} slots={slots} revealed={revealed} />
      </h2>
      <div className="subhead">
        <Fill text={page.subhead} slots={slots} revealed={revealed} />
      </div>
      <div className="cols">
        {page.body.map((p, i) => (
          <p key={i} style={{ margin: "0 0 8px" }}>
            <Fill text={p} slots={slots} revealed={revealed} />
          </p>
        ))}
      </div>
      <div className="box">
        <h3>{page.boxTitle}</h3>
        {page.boxLines.map((l, i) => (
          <div key={i}>
            <Fill text={l} slots={slots} revealed={revealed} />
          </div>
        ))}
      </div>
    </article>
  );
}
