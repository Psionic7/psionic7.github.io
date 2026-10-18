import React from 'react';

// Suspense handles waiting; this boundary keeps navigation available when a
// lazy chunk or the screen itself fails. Reload also clears rejected lazy imports.
export default class ScreenBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(this.state.failed)return <section className="panel" role="alert"><h2>조회 화면을 불러오지 못했습니다.</h2><p>연결을 확인한 뒤 새로고침해 주세요. 다른 메뉴는 계속 사용할 수 있습니다.</p><button onClick={()=>window.location.reload()}>페이지 새로고침</button></section>;
    return this.props.children;
  }
}
