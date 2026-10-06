import { describe, expect, it } from 'vitest';
import { parseObj } from '../src/io/obj';
import { NO_GROUP } from '../src/core/types';

describe('parseObj', () => {
  it('reads vertices with colours, polylines with v/vt refs, and groups', () => {
    const obj = parseObj([
      '# comment',
      'g ',
      'v 0 0 0 1 1 1',
      'v 1 0 0 1 0 0',
      'v 2 0 0',
      'vn 0 1 0',
      'l 1/1 2/2 3/3',
      'g baseForm inner',
      'l -3 -1',
    ].join('\n'));
    expect(obj.positions.length).toBe(9);
    expect([...obj.lines.offsets]).toEqual([0, 3, 5]);
    expect([...obj.lines.indices]).toEqual([0, 1, 2, 0, 2]);
    expect(obj.groups).toEqual([NO_GROUP, 'baseForm inner']);
    expect([...obj.lines.group]).toEqual([0, 1]);
  });

  it('fan-triangulates faces', () => {
    const obj = parseObj('v 0 0 0\nv 1 0 0\nv 1 0 1\nv 0 0 1\nf 1//1 2//2 3//3 4//4\n');
    expect([...obj.triangles]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('rejects out-of-range vertex references', () => {
    expect(() => parseObj('v 0 0 0\nl 1 2\n')).toThrow(/out of range/);
  });
});
