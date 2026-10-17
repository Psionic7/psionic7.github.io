import React,{useEffect,useRef,useState} from 'react';
export default function PreferenceControls({onResetPreferences}) {
  const [confirm,setConfirm]=useState(false),dialog=useRef(null),trigger=useRef(null);
  useEffect(()=>{if(confirm){trigger.current=document.activeElement;dialog.current?.focus();}else trigger.current?.focus();},[confirm]);
  const trap=event=>{
    if(event.key==='Escape'){setConfirm(false);return;}
    if(event.key!=='Tab')return;
    const buttons=dialog.current.querySelectorAll('button'),first=buttons[0],last=buttons[buttons.length-1];
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
  };
  return <div className="preference-actions"><button onClick={()=>onResetPreferences('queries')}>이 브라우저의 조회 설정 초기화</button><p>지역·기간·필터를 초기화합니다. 즐겨찾기는 그대로 보관합니다.</p><button className="danger-button" onClick={()=>setConfirm(true)}>즐겨찾기 전체 삭제</button><p>관심 동네와 아파트 목록만 삭제합니다. 삭제 전 확인하며 실행 후 되돌릴 수 있습니다.</p>
    {confirm&&<div className="confirm-backdrop"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-favorites-title" aria-describedby="delete-favorites-description" ref={dialog} tabIndex={-1} onKeyDown={trap}><h2 id="delete-favorites-title">즐겨찾기를 모두 삭제할까요?</h2><p id="delete-favorites-description">이 브라우저의 관심 동네와 아파트가 모두 삭제됩니다. 조회 조건은 유지되며, 삭제 직후 되돌릴 수 있습니다.</p><div><button onClick={()=>setConfirm(false)}>취소</button><button className="danger-button" onClick={()=>{setConfirm(false);onResetPreferences('favorites');}}>모든 즐겨찾기 삭제</button></div></div></div>}
  </div>;
}
