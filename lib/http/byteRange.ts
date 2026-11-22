/** Parses one inclusive HTTP byte range, including suffix/open ranges. Multiple and unsatisfiable ranges are rejected. */
const parseByteRange = function (header: string, size: number): [number, number] {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || (!match[1] && !match[2])) throw new RangeError('Invalid byte range');
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const last = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0 || first > last || first >= size || (!match[1] && Number(match[2]) <= 0)) throw new RangeError('Invalid byte range');
  return [first, last];
};

export { parseByteRange };
