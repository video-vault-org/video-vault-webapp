const range = function (header: string | null, size: number): [number, number] {
  if (!size) throw new RangeError('range');
  if (!header) return [0, size - 1];
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) throw new RangeError('range');
  const from = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])),
    to = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from > to ||
    from >= size ||
    (!m[1] && Number(m[2]) <= 0)
  )
    throw new RangeError('range');
  return [from, to];
};

export { range };
