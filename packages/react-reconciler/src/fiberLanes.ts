import {
	unstable_IdlePriority,
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_UserBlockingPriority,
	unstable_getCurrentPriorityLevel
} from 'scheduler';
import { FiberRootNode } from './fiber';
import currentBatchConfig from 'react/src/currentBatchConfig';

// 二进制位，代表优先级
export type Lane = number;
// 代表一个lane的集合
export type Lanes = number;

// 其中，lane作为update的优先级，Lanes作为lane的集合

// lane的产生
// 对于不同情况触发的更新，产生lane，为后续不同事件产生不同优先级更新做准备
// 如何知道那些lane被消费，还剩那些lane没被消费？

// 对FiberRootNode的改造

// 需要增加如下字段
// 代表所有未被消费的lane的集合
// 代表本次更新消费的lane
export const SyncLane = 0b00001;
export const NoLane = 0b00000;
export const NoLanes = 0b00000;
// 连续地输入
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
// 这个优先级较低，但是还不至于在空闲时才执行
export const TransitionLane = 0b01000;
export const IdleLane = 0b1000;

export function mergeLanes(LaneA: Lane, LaneB: Lane): Lanes {
	return LaneA | LaneB;
}
export function requestUpdateLane() {
	const isTransition = currentBatchConfig.transition !== null;
	if (isTransition) {
		return TransitionLane;
	}
	/**
	 *
	 * 当前我们掌握的优先级相关的信息，包括
	 * Scheduler的5种优先级
	 * React中的Lane模型
	 * 也就是说，运行在React时，使用的是lane模型，运行流程在Scheduler时，使用的是优先级，所以需要两者的转换
	 */
	// 从上下文获取环境中的Scheduler优先级
	// 我们这里获取的是调度器的优先级，但是我们返回的是一个lane，因此我们需要一套映射关系
	const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
	const lane = schedulerPriorityToLane(currentSchedulerPriority);
	return lane;
}

export function getHighestPriorityLane(lanes: Lanes) {
	// 越小优先级越高，当然0除外
	return lanes & -lanes;
}
// 比较优先级是否足够
export function isSubsetOfLanes(set: Lanes, subset: Lane) {
	// 表明传进来的subset优先级是足够的
	return (set & subset) === subset;
}

// 移除传进来的lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
	root.suspendedLanes = NoLanes;
	root.pingedLanes = NoLanes;
}

export function lanesToSchedulerPriority(lanes: Lanes) {
	const lane = getHighestPriorityLane(lanes);
	if (lane === SyncLane) {
		return unstable_ImmediatePriority;
	}
	if (lane === InputContinuousLane) {
		return unstable_UserBlockingPriority;
	}
	if (lane === DefaultLane) {
		return unstable_NormalPriority;
	}
	return unstable_IdlePriority;
}

export function schedulerPriorityToLane(schedulerPriority: number): Lane {
	if (schedulerPriority === unstable_ImmediatePriority) {
		return SyncLane;
	}
	if (schedulerPriority === unstable_UserBlockingPriority) {
		return InputContinuousLane;
	}
	if (schedulerPriority === unstable_NormalPriority) {
		return DefaultLane;
	}
	return NoLane;
}

// 标记root的某个lane被挂起了
export function markRootSuspended(root: FiberRootNode, suspendedLane: Lane) {
	root.suspendedLanes |= suspendedLane;
	// 被挂起了，就得从pendingLanes移除
	root.pendingLanes &= ~suspendedLane;
}

// 标记root的某个lane被ping了
export function markRootPinged(root: FiberRootNode, pingedLane: Lane) {
	// 取到pingedLane和suspendedLanes交集的部份再保存
	root.pingedLanes |= root.suspendedLanes & pingedLane;
}

export function getNextLane(root: FiberRootNode): Lane {
	const pendingLanes = root.pendingLanes;
	if (pendingLanes === NoLanes) {
		return NoLane;
	}
	let nextLane = NoLane;
	// pendingLanes中没有被挂起的lane
	const suspendedLanes = pendingLanes & ~root.suspendedLanes;
	if (suspendedLanes !== NoLanes) {
		nextLane = getHighestPriorityLane(suspendedLanes);
	} else {
		// 走到这里就说明所有的pendingLanes都被挂起了，但是我们还是寄希望于有些lane被ping了
		const pingedLanes = pendingLanes & root.pingedLanes;
		if (pingedLanes !== NoLanes) {
			nextLane = getHighestPriorityLane(pingedLanes);
		}
	}
	return nextLane;
}
