import React, {useEffect, useState} from 'react';
import RegionMap from '../admin/RegionMap.jsx';
import dongsUrl from '../admin/assets/dong_boundaries.geojson?url';
import districtsUrl from '../admin/assets/admin_boundaries.json?url';
import './cloud-region-map.css';

export default function CloudRegionMap({fetcher = fetch, errorMessage = '지역 경계 지도를 불러오지 못했습니다. 목록에서 지역을 선택하거나 다시 시도하세요.', ...props}) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    const read = async url => {
      const response = await fetcher(url);
      if (!response.ok) throw new Error();
      return response.json();
    };
    Promise.all([read(dongsUrl), read(districtsUrl)]).then(([boundaries, adminBoundaries]) => {
      if (!Array.isArray(boundaries.features) || !Array.isArray(adminBoundaries.cities?.features) ||
          !Array.isArray(adminBoundaries.districts?.features) || !adminBoundaries.styles) throw new Error();
      if (active) setData({boundaries, adminBoundaries});
    }).catch(() => {if (active) setError(errorMessage);});
    return () => {active = false;};
  }, [fetcher, retry, errorMessage]);
  if (error) return <div role="alert" className="notice error">{error}<button onClick={() => setRetry(value => value + 1)}>지도 다시 불러오기</button></div>;
  if (!data) return <p role="status">지역 레이어 지도를 불러오는 중입니다.</p>;
  return <div className="cloud-region-map"><RegionMap {...data} {...props} saveLabel="설정 저장" /></div>;
}
