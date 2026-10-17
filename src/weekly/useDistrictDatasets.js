import {useEffect, useMemo, useState} from 'react';

// A new manifest or loader owns a separate cache. Late responses can only
// populate their original cache, never the current data generation.
export function useDistrictDatasets(manifest, selectedCodes, districtLoader, retry = 0, request = {}) {
  const requestKey=districtLoader.supportsRanges?JSON.stringify(request):'';
  const cache = useMemo(() => new Map(), [manifest, districtLoader,requestKey]);
  const codesKey = JSON.stringify([...new Set(selectedCodes)].sort());
  const [snapshot, setSnapshot] = useState({cache, datasets: {}});

  useEffect(() => {
    let active = true;
    const datasets = {};
    for (const code of JSON.parse(codesKey)) {
      if (!manifest.districts[code]) continue;
      let entry = cache.get(code);
      if (!entry) {
        entry = {};
        entry.promise = Promise.resolve()
          .then(() => districtLoader.supportsRanges?districtLoader(manifest,code,{...request,catalogOnly:request.catalogOnlyCodes?.includes(code)}):districtLoader(manifest, code))
          .then(value => { entry.rows = Array.isArray(value)?{rows:value}:value; return entry.rows; })
          .catch(error => { cache.delete(code); throw error; });
        cache.set(code, entry);
      }
      if (entry.rows !== undefined) {
        datasets[code] = entry.rows;
        continue;
      }
      datasets[code] = {loading: true};
      const update = value => {
        if (active) setSnapshot(previous => ({
          cache,
          datasets: {...(previous.cache === cache ? previous.datasets : {}), [code]: value},
        }));
      };
      entry.promise.then(value => update(value), () => update({error: true}));
    }
    setSnapshot({cache, datasets});
    return () => { active = false; };
  }, [cache, codesKey, manifest, districtLoader, retry]);

  return snapshot.cache === cache ? snapshot.datasets : {};
}
