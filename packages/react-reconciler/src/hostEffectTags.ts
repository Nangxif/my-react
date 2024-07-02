// 这些状态是用在Effect上面的，而不是用在fiber上的，Effect上面有个tag属性
// 这个Passive指的是useEffect
export const Passive = 0b0010;
// 如果以后实现了useLayoutEffect，那么就用下面这个
// export  const Layout = 0b0001

// 下面这个状态代表需要触发回调
export const HookHasEffect = 0b0001;

/**
 * 对于fiber，新增PassiveEffect，代表当前fiber本次更新存在副作用
 * 至于本次更新存在哪种类型的副作用，是Effect还是useLayoutEffect，
 * 取决于effect hook上面的tag，Passive代表是useEffect
 * 对于effect hook，HookHasEffect代表当前effect本次更新存在副作用
 * 
*/

