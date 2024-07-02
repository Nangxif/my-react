import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from '../../shared/ReactTypes';
import { Lane, NoLane, isSubsetOfLanes } from './fiberLanes';
import { Update } from './fiberFlags';

export interface Update<State> {
	action: Action<State>;
	lane: Lane;
	next: Update<any> | null;
}

export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null;
	};
	dispatch: Dispatch<State> | null;
}

// 实现创建Update实例的方法
export const createUpdate = <State>(
	action: Action<State>,
	lane: Lane
): Update<State> => {
	return {
		action,
		lane,
		next: null
	};
};

// 实现一个初始化UpdateQueue实例的方法
export const createUpdateQueue = <State>() => {
	return {
		shared: {
			pending: null
		},
		dispatch: null
	} as UpdateQueue<State>;
};

// 接下来我们还需要一个方法就是往UpdateQueue里面增加Update
export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>
) => {
	// 对Update的调整，
	// 多次触发更新，只进行一次更新流程中的多次触发更新意味着对于多个fiber，会创建多个update
	// 但是我们之前的做法是把每次触发的更新都会覆盖上一次的更新，这无疑已经不支持现在的情况
	// updateQueue.shared.pending = update;
	const pending = updateQueue.shared.pending;
	if (pending === null) {
		update.next = update;
	} else {
		update.next = pending.next;
		pending.next = update;
	}
	updateQueue.shared.pending = update;
};

// UpdateQueue消费Update的方法
// 这里传进来的pendingUpdate应该是我们的baseQueue和我们原来的pendingUpdate合并后的结果，所以应该是在外面处理的
export const processUpdateQueue = <State>(
	// 初始状态
	baseState: State,
	pendingUpdate: Update<State> | null,
	renderLane: Lane
): {
	memoizedState: State;
	baseState: State;
	baseQueue: Update<State> | null;
} => {
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState,
		baseState,
		baseQueue: null
	};
	if (pendingUpdate !== null) {
		// 第一个update
		let first = pendingUpdate.next;
		let pending = pendingUpdate.next as Update<any>;
		// const action = pendingUpdate.action;
		// if (action instanceof Function) {
		// 	// baseState 1 update (x) => 4x -> memoizedState 4
		// 	result.memoizedState = action(baseState);
		// } else {
		// 	// baseState 1 update 2 -> memoizedState 2
		// 	result.memoizedState = action;
		// }

		let newBaseState = baseState;
		let newBaseQueueFirst: Update<State> | null = null;
		let newBaseQueueLast: Update<State> | null = null;
		let newState = baseState;
		do {
			const updateLane = pending?.lane;
			if (!isSubsetOfLanes(renderLane, updateLane)) {
				// 优先级不够被跳过

				const clone = createUpdate(pending.action, pending.lane);

				if (newBaseQueueFirst === null) {
					// 如果是第一个被跳过的
					newBaseQueueFirst = clone;
					newBaseQueueLast = clone;
					// 我们的baseState到这里就应该被固定下来了
					newBaseState = newState;
				} else {
					// first u0 -> u1 -> u2
					// 这里的newBaseQueueFirst还只是单向链表
					// last u2
					newBaseQueueLast!.next = clone;
					newBaseQueueLast = clone;
				}
			} else {
				// 	优先级足够
				if (newBaseQueueLast !== null) {
					const clone = createUpdate(pending.action, NoLane);
					newBaseQueueLast!.next = clone;
					newBaseQueueLast = clone;
				}
				const action = pending.action;
				if (action instanceof Function) {
					// baseState 1 update (x) => 4x -> memoizedState 4
					newState = action(baseState);
				} else {
					// baseState 1 update 2 -> memoizedState 2
					newState = action;
				}
			}
			pending = pending?.next as Update<any>;
		} while (pending !== first);

		if (newBaseQueueLast === null) {
			// 本次计算没有Update被跳过
			newBaseState = newState;
		} else {
			// 有被跳过的Update，这时候得把newBaseQueueFirst和newBaseQueueLast合成环状链表
			newBaseQueueLast.next = newBaseQueueFirst;
		}
		result.memoizedState = newState;
		result.baseState = newBaseState;
		result.baseQueue = newBaseQueueLast;
	}
	return result;
};
