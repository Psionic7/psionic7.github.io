import React, {StrictMode} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import {useDistrictDatasets} from '../src/weekly/useDistrictDatasets.js';

const manifest = {districts: {a: {file: 'a-v1.json'}, b: {file: 'b-v1.json'}}};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
afterEach(cleanup);

it('deduplicates pending requests in StrictMode and reuses successful empty datasets after reselection', async () => {
  const pending = deferred();
  const loader = vi.fn(() => pending.promise);
  const {result, rerender} = renderHook(({codes}) => useDistrictDatasets(manifest, codes, loader), {
    initialProps: {codes: ['a', 'a', 'unknown']}, wrapper: StrictMode,
  });
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  rerender({codes: []});
  rerender({codes: ['a']});
  await act(async () => pending.resolve([]));
  expect(result.current.a.rows).toEqual([]);
  rerender({codes: []});
  rerender({codes: ['a']});
  expect(result.current.a.rows).toEqual([]);
  expect(result.current.unknown).toBeUndefined();
  expect(loader).toHaveBeenCalledTimes(1);
});

it('does not reuse completed rows when a manifest changes for the same district', async () => {
  const loader = vi.fn(async (value, code) => [value.districts[code].file]);
  const {result, rerender} = renderHook(({value}) => useDistrictDatasets(value, ['a'], loader), {
    initialProps: {value: manifest},
  });
  await waitFor(() => expect(result.current.a.rows).toEqual(['a-v1.json']));
  rerender({value: {districts: {a: {file: 'a-v2.json'}}}});
  expect(result.current.a?.rows).toBeUndefined();
  await waitFor(() => expect(result.current.a.rows).toEqual(['a-v2.json']));
  expect(loader).toHaveBeenCalledTimes(2);
});

it('late responses from an old manifest cannot overwrite or poison the new cache', async () => {
  const oldRequest = deferred(), newRequest = deferred();
  const loader = vi.fn(value => value === manifest ? oldRequest.promise : newRequest.promise);
  const next = {districts: {a: {file: 'a-v2.json'}}};
  const {result, rerender} = renderHook(({value, codes}) => useDistrictDatasets(value, codes, loader), {
    initialProps: {value: manifest, codes: ['a']},
  });
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  rerender({value: next, codes: ['a']});
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  await act(async () => newRequest.resolve(['new']));
  await act(async () => oldRequest.resolve(['old']));
  expect(result.current.a.rows).toEqual(['new']);
  rerender({value: next, codes: []});
  rerender({value: next, codes: ['a']});
  expect(result.current.a.rows).toEqual(['new']);
  expect(loader).toHaveBeenCalledTimes(2);
});

it('a replacement loader gets its own cache even with the same manifest', async () => {
  const first = vi.fn(async () => ['first']), second = vi.fn(async () => ['second']);
  const {result, rerender} = renderHook(({loader}) => useDistrictDatasets(manifest, ['a'], loader), {
    initialProps: {loader: first},
  });
  await waitFor(() => expect(result.current.a.rows).toEqual(['first']));
  rerender({loader: second});
  await waitFor(() => expect(result.current.a.rows).toEqual(['second']));
  expect(second).toHaveBeenCalledTimes(1);
});

it('retries failed districts while retaining successful rows and catches synchronous loader failures', async () => {
  let fail = true;
  const loader = vi.fn((_value, code) => {
    if (code === 'b' && fail) throw new Error('offline');
    return Promise.resolve([code]);
  });
  const {result, rerender} = renderHook(({retry}) => useDistrictDatasets(manifest, ['a', 'b'], loader, retry), {
    initialProps: {retry: 0},
  });
  await waitFor(() => expect(result.current.b.error).toBe(true));
  expect(result.current.a.rows).toEqual(['a']);
  fail = false;
  rerender({retry: 1});
  await waitFor(() => expect(result.current.b.rows).toEqual(['b']));
  expect(loader.mock.calls.map(([, code]) => code)).toEqual(['a', 'b', 'b']);
});
