import React, {useId, useState} from 'react';
import {ChevronDown} from 'lucide-react';
import './collapsible-panel.css';

export default function CollapsiblePanel({label,toggleLabel=label,className='',headingClassName='',heading,actions,children}) {
  const [expanded,setExpanded]=useState(true);
  const contentId=useId();
  const toggleText=toggleLabel+' '+(expanded?'접기':'펼치기');
  return <section className={`panel collapsible-panel ${className}${expanded?' expanded':''}`} aria-label={label}>
    <div className={`section-title collapsible-panel-heading ${headingClassName}`}>
      <div className="collapsible-panel-title">{heading}</div>
      <div className="collapsible-panel-actions">
        {actions}
        <button type="button" className="collapsible-panel-toggle" aria-label={toggleText} title={toggleText} aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(value=>!value)}>
          <ChevronDown size={18} aria-hidden="true"/>
        </button>
      </div>
    </div>
    <div id={contentId} className="collapsible-panel-content" hidden={!expanded}>{children}</div>
  </section>;
}
