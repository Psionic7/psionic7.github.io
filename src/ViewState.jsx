import React from 'react';
import { RefreshCw, Database } from 'lucide-react';

export function Loading({ text = '실거래 데이터를 불러오는 중입니다.' }) {
  return <div className="loading" role="status"><RefreshCw size={22} className="spin" />{text}</div>;
}
export function Empty({ title = '이 조건에 해당하는 실거래가 없습니다.', children }) {
  return <div className="empty"><Database size={32} /><h3>{title}</h3><p>{children || '지역이나 계약월, 면적 조건을 바꿔 보세요.'}</p></div>;
}
