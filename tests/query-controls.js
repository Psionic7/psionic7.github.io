import {screen,fireEvent} from '@testing-library/react';
// Existing transaction scenarios edit filters; enter that explicit UI mode first.
export async function openQueryControls(){
  const tab=document.querySelector('.public-shell')?.dataset.tab;
  if(!['apartments','weekly'].includes(tab))return;
  const conditions=await screen.findByRole('button',{name:/기간 \/ 조건/},{timeout:10000});
  if(conditions.getAttribute('aria-expanded')==='false')fireEvent.click(conditions);
  const selection=screen.getByRole('button',{name:/선택 · 변경 \/ 비교 추가|지역별 단지 목록에서 선택|조회할 동네 선택/});
  if(selection.getAttribute('aria-expanded')==='false')fireEvent.click(selection);
}
