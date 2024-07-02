export type WorkTag =
	| typeof FunctionComponent
	| typeof HostRoot
	| typeof HostComponent
	| typeof HostText
	| typeof Fragment
	| typeof ContextProvider
	| typeof SuspenseComponent
	| typeof OffScreenComponent;

export const FunctionComponent = 0;
// 项目挂载的根节点对应的fiber节点的类型
// ReactDOM.render()
export const HostRoot = 3;
// <div>对应的fiberNode
export const HostComponent = 5;
// <div>123</div>里面的123对应的fiberNode
export const HostText = 6;
export const Fragment = 7;

export const ContextProvider = 8;
export const SuspenseComponent = 13;
export const OffScreenComponent = 14;
