/** 공고 스크린샷 판독 채점: 공백·목록 기호를 빼고 글자 단위 편집 거리로 비교한다 */

export function normalize(text: string): string {
  // 굵게(**)를 먼저 지워야 "**담당업무**"의 첫 *가 목록 기호로 잘못 지워지지 않는다
  return text.replace(/\*\*/g, "").replace(/^[ \t]*(?:#{1,6}|[-*·•])[ \t]*/gm, "").replace(/\s/g, "");
}

/** 편집 연산 경로까지 구해 틀린 구간을 뽑는다. 붙어 있는 편집은 한 구간으로 묶는다 (공고 한 장 분량이라 O(n·m)으로 충분) */
export function scoreOcr(truth: string, output: string) {
  const a = [...normalize(truth)];
  const b = [...normalize(output)];
  const n = a.length;
  const m = b.length;
  const d: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  // 경로를 거꾸로 따라가며 다른 구간을 묶는다
  const diffs: { truth: string; output: string }[] = [];
  let i = n;
  let j = m;
  let cur: { truth: string; output: string } | null = null;
  const flush = () => {
    if (cur) diffs.unshift(cur);
    cur = null;
  };
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      flush();
      i--;
      j--;
      continue;
    }
    cur ??= { truth: "", output: "" };
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      cur.truth = a[--i] + cur.truth;
      cur.output = b[--j] + cur.output;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      cur.truth = a[--i] + cur.truth;
    } else {
      cur.output = b[--j] + cur.output;
    }
  }
  flush();
  const distance = d[n][m];
  return {
    accuracy: n === 0 ? 0 : Math.max(0, 1 - distance / n),
    distance,
    truthChars: n,
    diffs,
  };
}
