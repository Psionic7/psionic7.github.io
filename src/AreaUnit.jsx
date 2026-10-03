import React from 'react';

export default function AreaUnit({value, onChange}) {
  return <div className="area-unit" role="group" aria-label="전용면적 표시 단위">
    <span>면적 단위</span>
    <div className="unit-buttons">
      <button type="button" aria-pressed={value === 'm2'} onClick={() => onChange('m2')}>㎡</button>
      <button type="button" aria-pressed={value === 'pyeong'} onClick={() => onChange('pyeong')}>평 (전용)</button>
    </div>
  </div>;
}
