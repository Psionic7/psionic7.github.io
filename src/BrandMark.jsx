import React from 'react';
import brandMarkUrl from './brand-mark.svg';
import './brand-mark.css';

export default function BrandMark() {
  return <img src={brandMarkUrl} className="brand-mark" width="48" height="48" alt="" aria-hidden="true" draggable={false}/>;
}
