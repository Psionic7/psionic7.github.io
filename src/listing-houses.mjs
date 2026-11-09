// Only the provider's explicit representative→advertisement relationship joins homes.
export function listingHouses(articles){
  const groups=new Map(),seen=new Set();
  for(const article of articles){
    if(seen.has(article.id))continue;seen.add(article.id);
    const key=article.providerHouseId||`unconfirmed:${article.id}`;
    if(!groups.has(key))groups.set(key,{id:key,confirmed:Boolean(article.providerHouseId),articles:[]});
    groups.get(key).articles.push(article);
  }
  return [...groups.values()].map(group=>({...group,representative:group.articles.reduce((a,b)=>a.priceMan<=b.priceMan?a:b),minPrice:Math.min(...group.articles.map(a=>a.priceMan)),maxPrice:Math.max(...group.articles.map(a=>a.priceMan))}));
}
