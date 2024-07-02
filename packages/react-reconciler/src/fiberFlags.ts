export type Flags = number;
export const NoFlags = 0b0000000;
export const Placement = 0b0000001;
export const Update = 0b0000010;
export const ChildDeletion = 0b0000100;

// 代表这个fiber上本次更新存在需要触发useEffect的情况
export const PassiveEffect = 0b0001000;

//  Ref也是一种flag
export const Ref = 0b0010000;

// Offscreen的可见性发生变化
export const Visibility = 0b0100000;
export const DidCapture = 0b1000000;

// render阶段捕获到一些东西，这些东西可能是我们抛出去的挂起的数据，也可能是error boundry的一些错误
export const ShouldCapture = 0b01000000;

// 那什么情况下需要触发useEffect呢?一个是fiber包含PassiveEffect，一个是包含ChildDeletion，因为删除的时候需要执行destroy
export const PassiveMask = PassiveEffect | ChildDeletion;

// 如果当前的subtreeFlags或者flags中包含了MutationMask中指定的这些flags，那么代表了当前我们需要执行mutation这个阶段
// mutation阶段可能要进行的工作
export const MutationMask =
	Placement | Update | ChildDeletion | Ref | Visibility;
export const LayoutMask = Ref;
