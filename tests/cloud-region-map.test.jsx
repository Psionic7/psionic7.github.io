import React from 'react';
import {afterEach, test, expect, vi} from 'vitest';
import {render, screen, cleanup, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../admin/RegionMap.jsx', () => ({default: ({saveLabel}) => <div role="region" aria-label="지역 레이어 지도">{saveLabel}</div>}));
import CloudRegionMap from '../src/CloudRegionMap.jsx';
afterEach(cleanup);
test('failed boundaries keep a retry available and load the map with the web save instruction', async () => {
  let failed = true;
  const fetcher = vi.fn(async url => ({ok: !failed, json: async () => String(url).includes('dong_boundaries') ? {features: []} : {cities: {features: []}, districts: {features: []}, styles: {}}}));
  render(<CloudRegionMap fetcher={fetcher} />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('region', {name: '지역 레이어 지도'})).toBeNull();
  failed = false;
  await userEvent.setup().click(screen.getByRole('button', {name: '지도 다시 불러오기'}));
  await waitFor(() => expect(screen.getByRole('region', {name: '지역 레이어 지도'}).textContent).toBe('설정 저장'));
});
