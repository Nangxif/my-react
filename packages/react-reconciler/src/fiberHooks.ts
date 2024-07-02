import internals from 'shared/internals';
import { FiberNode } from './fiber';
import { Dispatcher } from 'react/src/currentDispatcher';
import { Dispatch } from 'react/src/currentDispatcher';
import {
	Update,
	UpdateQueue,
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue
} from './updateQueue';
import { Action, ReactContext, Thenable, Usable } from 'shared/ReactTypes';
import { scheduleUpdateOnFiber } from './workLoop';
import { Lane, NoLane, requestUpdateLane } from './fiberLanes';
import { Flags, PassiveEffect } from './fiberFlags';
import { HookHasEffect, Passive } from './hostEffectTags';
import currentBatchConfig from 'react/src/currentBatchConfig';
import { REACT_CONTEXT_TYPE } from 'shared/ReactSymbols';
import { trackUsedThenable } from './thenable';

/**
 * 存放当前hook调用的时候所在的函数组件workInProgress fiber
 * 它的memoizedState存放着当前函数组件里面hook链表的第一个项
 */
let currentlyRenderingFiber: FiberNode | null = null;
/**
 * 存放当前在某一个函数组件里面mount时执行到的hook，是一个链表，workInProgressHook指向当前函数组件最后一个hook
 * workInProgressHook就是一个游标
 */
let workInProgressHook: Hook | null = null;
/*
 * 存放当前在某一个函数组件里面update时执行到的hook，是一个链表，workInProgressHook指向当前函数组件最后一个hook
 * workInProgressHook就是一个游标
 * */
let currentHook: Hook | null = null;

let renderLane: Lane = NoLane;

const { currentDispatcher } = internals;
interface Hook {
	memoizedState: any;
	updateQueue: unknown;
	next: Hook | null;
	baseState: any;
	baseQueue: Update<any> | null;
}

export interface Effect {
	tag: Flags;
	create: EffectCallback | void;
	destroy: EffectCallback | void;
	deps: EffectDeps;
	next: Effect | null;
}
type EffectCallback = () => void;
type EffectDeps = any[] | null;

export interface FCUpdateQueue<State> extends UpdateQueue<State> {
	lastEffect: Effect | null;
}
export function renderWithHooks(wip: FiberNode, lane: Lane) {
	// 赋值操作
	currentlyRenderingFiber = wip;
	// 重置 hooks 链表
	wip.memoizedState = null;
	// 	重置effect链表
	wip.updateQueue = null;
	renderLane = lane;
	const current = wip.alternate;
	if (current !== null) {
		// update
		currentDispatcher.current = HookDispatcherOnUpdate;
	} else {
		// mount
		currentDispatcher.current = HookDispatcherOnMount;
	}

	const Component = wip.type;
	const props = wip.pendingProps;
	const children = Component(props);

	// 重置操作
	currentlyRenderingFiber = null;
	workInProgressHook = null;
	currentHook = null;
	renderLane = NoLane;
	return children;
}

const HookDispatcherOnMount: Dispatcher = {
	useState: mountState,
	useEffect: mountEffect,
	useTransition: mountTransition,
	useRef: mountRef,
	useContext: readContext,
	use
};

const HookDispatcherOnUpdate: Dispatcher = {
	useState: updateState,
	useEffect: updateEffect,
	useTransition: updateTransition,
	useRef: updateRef,
	useContext: readContext,
	use
};

function mountEffect(create: EffectCallback | void, deps: EffectDeps | void) {
	const hook = mountWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	// mount时，fiber是需要处理副作用的
	currentlyRenderingFiber!.flags |= PassiveEffect;
	hook.memoizedState = pushEffect(
		Passive | HookHasEffect,
		create,
		undefined,
		nextDeps
	);
}
function updateEffect(create: EffectCallback | void, deps: EffectDeps | void) {
	const hook = updateWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	let destroy: EffectCallback;
	if (currentHook !== null) {
		const prevEffect = currentHook.memoizedState as Effect;
		destroy = prevEffect.destroy as EffectCallback;
		if (nextDeps !== null) {
			// 接下来就需要浅比较依赖了
			const prevDeps = prevEffect.deps;
			if (areHookInputsEqual(nextDeps, prevDeps)) {
				hook.memoizedState = pushEffect(Passive, create, destroy, nextDeps);
				return;
			}
			// 浅比较后不相等

			currentlyRenderingFiber!.flags |= PassiveEffect;
			hook.memoizedState = pushEffect(
				Passive | HookHasEffect,
				create,
				destroy,
				nextDeps
			);
		}
	}
}

function areHookInputsEqual(nextDeps: EffectDeps, prevDeps: EffectDeps) {
	if (nextDeps === null || prevDeps === null) {
		/**
		 *
		 * 这种情况对应依赖没写
		 * useEffect(()=>{})
		 */
		// 那么比较的结果永远是不相等的，一直需要更新
		return false;
	}
	for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
		if (Object.is(prevDeps[i], nextDeps[i])) {
			continue;
		}
		return false;
	}
	return true;
}

// 将effect插入到fiber的updateQueue环状链表上面，同时将effect返回
function pushEffect(
	hookFlags: Flags,
	create: EffectCallback | void,
	destroy: EffectCallback | void,
	deps: EffectDeps
): Effect {
	const effect: Effect = {
		tag: hookFlags,
		create,
		destroy,
		deps,
		next: null
	};
	const fiber = currentlyRenderingFiber as FiberNode;
	// effect对应的环状列表应该存在哪里
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue === null) {
		const updateQueue = createFCUpdateQueue();
		fiber.updateQueue = updateQueue;
		effect.next = effect;
		updateQueue.lastEffect = effect;
	} else {
		// 插入effect，这一步我感觉执行不到
		const lastEffect = updateQueue.lastEffect;
		if (lastEffect === null) {
			effect.next = effect;
			updateQueue.lastEffect = effect;
		} else {
			// 将effect追加到链表的最后面
			const firstEffect = lastEffect.next;
			lastEffect.next = effect;
			effect.next = firstEffect;
			updateQueue.lastEffect = effect;
		}
	}
	return effect;
}

function createFCUpdateQueue<State>() {
	const updateQueue = createUpdateQueue() as FCUpdateQueue<State>;
	updateQueue.lastEffect = null;
	return updateQueue;
}

function updateState<State>(): [State, Dispatch<State>] {
	// 找到当前useState对应的hook数据
	const hook = updateWorkInProgressHook();
	// 计算新的state的逻辑
	const queue = hook.updateQueue as UpdateQueue<State>;
	const baseState = hook.baseState;
	const pending = queue.shared.pending;
	const current = currentHook as Hook;
	let baseQueue = current.baseQueue;

	if (pending !== null) {
		// 	pending baseQueue update保存在current中
		// 这里要将pending和baseQueue合并在一起
		if (baseQueue !== null) {
			const baseFirst = baseQueue.next;
			const pendingFirst = pending.next;
			baseFirst!.next = pendingFirst;
			pending.next = baseFirst;
		}
		baseQueue = pending;
		current.baseQueue = pending;
		queue.shared.pending = null;
	}

	if (baseQueue !== null) {
		const {
			memoizedState,
			baseQueue: newBaseQueue,
			baseState: newBaseState
		} = processUpdateQueue(baseState, baseQueue, renderLane);
		hook.memoizedState = memoizedState;
		hook.baseQueue = newBaseQueue;
		hook.baseState = newBaseState;
	}

	return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

function updateWorkInProgressHook(): Hook {
	// hook的数据从哪里来？从current的memoizedState来
	/**
	 *
	 * 什么情况下会触发updateWorkInProgressHook？
	 * 第一种情况：交互阶段触发的更新
	 * <div onClick={()=>update(1)}></div>
	 * 第二种情况：render阶段触发的更新
	 * function App () {
	 *  const [num,setNum] = useState(0);
	 * // 触发更新
	 *  setNum(100);
	 * return <div>{num}</div>
	 * }
	 */
	let nextCurrentHook: Hook | null;
	if (currentHook === null) {
		// 这是一个FC update时的第一个hook
		const current = currentlyRenderingFiber?.alternate;
		if (current !== null) {
			nextCurrentHook = current?.memoizedState;
		} else {
			// mount阶段，应该走不到这里，因为updateWorkInProgressHook只有在update的时候才会执行到
			nextCurrentHook = null;
		}
	} else {
		// 这个FC update时，后续的hook
		nextCurrentHook = currentHook.next;
	}

	if (nextCurrentHook === null) {
		// 在mount的时候或者在上一次update的时候，有三个hook，u1，u2，u3
		// 在本次update时，有四个hook                      u1，u2，u3，u4
		throw new Error(
			`组件${currentlyRenderingFiber?.type}本次执行时的Hook比上次执行时多`
		);
	}
	// 接下来开始复用nextCurrentHook
	currentHook = nextCurrentHook as Hook;
	const newHook = {
		memoizedState: currentHook.memoizedState,
		updateQueue: currentHook.updateQueue,
		baseState: currentHook.baseState,
		baseQueue: currentHook.baseQueue,
		next: null
	} as Hook;
	if (workInProgressHook === null) {
		if (currentlyRenderingFiber === null) {
			// 在函数组件外调用hook的时候，currentlyRenderingFiber是不会被赋值的
			// 这个表示我们没有在一个函数组件内调用Hook
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = newHook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时，同一个函数组件里面后续的hook会一个一个往workInProgressHook链表上添加
		// 然后把第二个hook添加到第一个hook的next上面去
		workInProgressHook.next = newHook;
		// 并且把workInProgressHook指向第二个hook
		workInProgressHook = newHook;
	}
	return workInProgressHook;
}

// 在mount阶段执行的useState
function mountState<State>(
	initialState: (() => State) | State
): [State, Dispatch<State>] {
	// 找到当前useState对应的hook数据
	const hook = mountWorkInProgressHook();
	let memoizedState;
	if (initialState instanceof Function) {
		memoizedState = initialState();
	} else {
		memoizedState = initialState;
	}

	const queue = createUpdateQueue<State>();
	hook.updateQueue = queue;
	hook.memoizedState = memoizedState;
	hook.baseState = memoizedState;
	// @ts-ignore
	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
	queue.dispatch = dispatch;
	return [memoizedState, dispatch];
}
function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	/**
	 * 当函数组件里面调用到setState到时候，就会触发dispatch
	 * 而dispatch是由dispatchSetState通过bind绑定了currentlyRenderingFiber, queue而来的
	 * queue的结构是
	 * {
		shared: {
			pending: null
		},
		dispatch
	}
	*/
	/**
	 * update的结构为
	 * {
	 * 		action: 2
	 * }
	 */
	const lane = requestUpdateLane();
	const update = createUpdate(action, lane);
	/**
	 * updateQueue就是在mount的时候绑定的queue，这一步之时往
	 */
	enqueueUpdate(updateQueue, update);
	/**
	 *
	 */
	scheduleUpdateOnFiber(fiber, lane);
}

// mount阶段查找当前的hook，并且把某个函数组件里面的hook串联起来
function mountWorkInProgressHook(): Hook {
	const hook: Hook = {
		// update的时候存放setState最新的值
		memoizedState: null,
		updateQueue: null,
		baseQueue: null,
		baseState: null,
		// 指向下一个hook
		next: null
	};
	if (workInProgressHook === null) {
		// mount时，而且是第一个hook
		if (currentlyRenderingFiber === null) {
			// 在函数组件外调用hook的时候，currentlyRenderingFiber是不会被赋值的
			// 这个表示我们没有在一个函数组件内调用Hook
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = hook;
			// mount时第一个hook
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时，同一个函数组件里面后续的hook会一个一个往workInProgressHook链表上添加
		// 然后把第二个hook添加到第一个hook的next上面去
		workInProgressHook.next = hook;
		// 并且把workInProgressHook指向第二个hook
		workInProgressHook = hook;
	}
	return workInProgressHook;
}

function mountTransition(): [boolean, (callback: () => void) => void] {
	const [isPending, setPending] = mountState(false);
	const hook = mountWorkInProgressHook();
	const start = startTransition.bind(null, setPending);
	hook.memoizedState = start;
	return [isPending, start];
}
function updateTransition(): [boolean, (callback: () => void) => void] {
	const [isPending] = updateState();
	const hook = updateWorkInProgressHook();
	const start = hook.memoizedState;
	return [isPending as boolean, start];
}

function startTransition(setPending: Dispatch<boolean>, callback: () => void) {
	setPending(true);
	const prevTransition = currentBatchConfig.transition;
	currentBatchConfig.transition = 1;
	callback();
	setPending(false);
	currentBatchConfig.transition = prevTransition;
}

// re = useRef(null)
function mountRef<T>(initialValue: T): { current: T } {
	const hook = mountWorkInProgressHook();
	const ref = { current: initialValue };
	hook.memoizedState = ref;
	return ref;
}

function updateRef<T>(initialValue: T): { current: T } {
	const hook = updateWorkInProgressHook();
	return hook.memoizedState;
}

function readContext<T>(context: ReactContext<T>): T {
	// 这里没有用到mountWorkInProgressHook这条链表上的数据，说明useContext没有其他hook的限制
	// 因此useContext可以在if语句中使用
	const consumer = currentlyRenderingFiber;
	if (consumer === null) {
		throw new Error('只能在函数组件中调用useContext');
	}
	const value = context._currentValue;
	return value;
}

/**
 * use可以接受两种类型的参数
 * Thenable 其实就是一个包装过后的promise
 * ReactContext，也就是说use可以当useContext使用
 */
function use<T>(usable: Usable<T>): T {
	if (usable !== null && typeof usable === 'object') {
		if (typeof (usable as Thenable<T>).then === 'function') {
			// thenable
			const thenable = usable as Thenable<T>;
			// 接下来要将用户传进来的Promise转换为thenable
			return trackUsedThenable(thenable);
		} else if ((usable as ReactContext<T>).$$typeof === REACT_CONTEXT_TYPE) {
			const context = usable as ReactContext<T>;
			return readContext(context);
		}
	}
	throw new Error('不支持的use参数:' + usable);
}

export function resetHooksOnUnwind() {
	currentlyRenderingFiber = null;
	currentHook = null;
	workInProgressHook = null;
}
