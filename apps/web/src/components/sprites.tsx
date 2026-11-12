import type { GameId } from "@trivela/protocol";

/** Pixel-art sprites drawn from character maps (no image assets). */
const PALETTE: Record<string, string> = {
  w: "#f2f2ff",
  k: "#0b0b1a",
  y: "var(--accent)",
  r: "#ff3b3b",
  g: "#2fbf4a",
  b: "#2a7fff",
  o: "#c97b2e",
  f: "#ffd2a8",
  c: "currentColor",
  d: "#5a5a8c",
};

const MAPS = {
  ball: ["....wwww....", "..wwkwwkww..", ".wwkkwwkkww.", ".wkwwwwwwkw.", "wwwwwkkwwwww", "wkwwkkkkwwkw", "wkwwkkkkwwkw", "wwwwwkkwwwww", ".wkwwwwwwkw.", ".wwkkwwkkww.", "..wwkwwkww..", "....wwww...."],
  trophy: [".yyyyyyyyyy.", "yyyyyyyyyyyy", "y.yyyyyyyy.y", "y.yywyyyyy.y", ".yyywyyyyyy.", "..yyyyyyyy..", "...yyyyyy...", "....yyyy....", ".....yy.....", ".....yy.....", "...yyyyyy...", "..yyyyyyyy.."],
  tiro_secco: ["....rrrr....", "..rrwwwwrr..", ".rwwwwwwwwr.", ".rwwrrrrwwr.", "rwwrrwwrrwwr", "rwwrwrrwrwwr", "rwwrwrrwrwwr", "rwwrrwwrrwwr", ".rwwrrrrwwr.", ".rwwwwwwwwr.", "..rrwwwwrr..", "....rrrr...."],
  prima_pagina: ["wwwwwwwwwww.", "wkkkkkkkkkw.", "wwwwwwwwwwww", "wddddwkkkkww", "wddddwwwwwww", "wddddwkkkkww", "wwwwwwwwwwww", "wkkkkkkkkkww", "wwwwwwwwwwww", "wkkkkkkkkkww", "wwwwwwwwwwww", ".wwwwwwwwww."],
  mercato: ["....yyyy....", "..yyyyyyyy..", ".yyyyookyyy.", ".yyyookkyyy.", "yyyooyyyyyyy", "yyoooooyyyyy", "yyyooyyyyyyy", "yyoooooyyyyy", ".yyyookkyyy.", ".yyyyookyyy.", "..yyyyyyyy..", "....yyyy...."],
  decina: ["............", ".yy..yyyyy..", "yyy.yy...yy.", ".yy.yy...yy.", ".yy.yy...yy.", ".yy.yy...yy.", ".yy.yy...yy.", ".yy.yy...yy.", ".yy.yy...yy.", "yyyy.yyyyy..", "............", "............"],
  dischetto: ["wwwwwwwwwwww", "w.d.d.d.d.dw", "wd.d.d.d.d.w", "w.d.d.d.d.dw", "wd.d.d.d.d.w", "w.d.d.d.d.dw", "w..........w", "w....ww....w", "gggwkwwkwggg", "gggwwkkwwggg", "ggggwwwwgggg", "gggggggggggg"],
  formazione: ["gggggggggggg", "gwwwwwwwwwwg", "gw...ww...wg", "gw.y.ww.r.wg", "gw...ww...wg", "gwy..ww..rwg", "gw...ww...wg", "gw.y.ww.r.wg", "gw...ww...wg", "gwwwwwwwwwwg", "gggggggggggg", "............"],
  giramondo: ["....bbbb....", "..bbggbbbb..", ".bgggggbbbb.", ".bggggbbbgb.", "bbgggbbbgggb", "bbbggbbbgggb", "bbbbgbbbbggb", "bbbbggbbbbbb", ".bbbgggbbbb.", ".bbbbggbbbb.", "..bbbbgbbb..", "....bbbb...."],
  frame: ["....wwww....", "..wwkkkkww..", ".wkkkykkkkw.", ".wkkkykkkkw.", "wkkkkykkkkkw", "wkkkkykkkkkw", "wkkkkyyyykkw", "wkkkkkkkkkkw", ".wkkkkkkkkw.", ".wkkkkkkkkw.", "..wwkkkkww..", "....wwww...."],
  asta: ["..oooo......", ".oooooo.....", "oooooooo....", ".oooooooo...", "..oooooo.o..", "...oooo.ooo.", "....oo...ooo", "..........oo", "............", ".yyyyyyyy...", "yyyyyyyyyy..", "............"],
  maglia: ["..cc....cc..", ".cccwwwwccc.", "cccccwwccccc", "cccccccccccc", "cc.cccccc.cc", "...cccccc...", "...cwwwwc...", "...cccccc...", "...cccccc...", "...cccccc...", "...cccccc...", "...cccccc..."],
  face: ["..cccccccc..", ".cccccccccc.", ".cffffffffc.", ".ffkffffkff.", ".ffkffffkff.", ".ffffffffff.", ".fffkkkkfff.", "..ffffffff..", "...cccccc...", ".cccccccccc.", "cccccccccccc", "cccccccccccc"],
  phone: ["..dddddddd..", "..dkkkkkkd..", "..dkcccckd..", "..dkcccckd..", "..dkcccckd..", "..dkcccckd..", "..dkcccckd..", "..dkcccckd..", "..dkkkkkkd..", "..dddwwddd..", "..dddddddd..", "............"],
  screen: ["dddddddddddd", "dkkkkkkkkkkd", "dkccckkccckd", "dkccckkccckd", "dkkkkkkkkkkd", "dkyyyyyyyykd", "dkkkkkkkkkkd", "dddddddddddd", ".....dd.....", ".....dd.....", "...dddddd...", "............"],
} as const;

export type SpriteName = keyof typeof MAPS;

export function Sprite({ name, size = 96, className = "" }: { name: SpriteName; size?: number; className?: string }) {
  const rows = MAPS[name];
  const rects: JSX.Element[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      if (ch !== ".") rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={w} height={1.02} fill={PALETTE[ch]} />);
      x += w;
    }
  });
  return (
    <svg className={`sprite ${className}`} width={size} height={size} viewBox={`0 0 ${rows[0]!.length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}

export const GameIcon = ({ game, size, className }: { game: GameId; size?: number; className?: string }) => <Sprite name={game} size={size} className={className} />;

/** Accent colour of each game (HUD badge, intro card). */
export const GAME_COLORS: Record<GameId, string> = {
  tiro_secco: "#ff5a5a",
  prima_pagina: "#f3d9cf",
  mercato: "#ffe600",
  decina: "#ff9f1c",
  dischetto: "#39ff14",
  formazione: "#2fbf4a",
  giramondo: "#4aa3ff",
  frame: "#c084fc",
  asta: "#e0a060",
  maglia: "#00e5ff",
};
