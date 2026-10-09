import React, {useId, useState} from 'react';
import {ChevronDown} from 'lucide-react';

export default function FilterGroup({number,title,label=title,icon:Icon,caption,actions,className='',children}) {
  const [expanded,setExpanded]=useState(true);
  const contentId=useId();
  return <section className={`dong-filter-card filter-group ${className}${expanded?' expanded':''}`} aria-label={label}>
    <div className="dong-filter-heading">
      <div className="filter-group-heading-main">
        <h3><span className="filter-step">{number}</span>{Icon&&<Icon size={16}/>}<span>{title}</span></h3>
        {expanded&&caption&&<span className="filter-caption">{caption}</span>}
        {expanded&&actions}
      </div>
      <button type="button" className="filter-group-toggle" aria-label={`${title} ${expanded?'접기':'펼치기'}`} title={`${title} ${expanded?'접기':'펼치기'}`} aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(value=>!value)}>
        <ChevronDown className="filter-group-chevron" size={16}/>
      </button>
    </div>
    <div id={contentId} hidden={!expanded}>{children}</div>
  </section>;
}
