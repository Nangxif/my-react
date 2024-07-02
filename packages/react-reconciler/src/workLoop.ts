import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListCreate,
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitLayoutEffects,
	commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
	FiberNode,
	FiberRootNode,
	PendingPassiveEffects,
	createWorkInProgress
} from './fiber';
import { MutationMask, NoFlags, PassiveMask } from './fiberFlags';
import {
	Lane,
	NoLane,
	SyncLane,
	getHighestPriorityLane,
	getNextLane,
	lanesToSchedulerPriority,
	markRootFinished,
	markRootSuspended,
	mergeLanes
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_scheduleCallback as schedulerCallback,
	unstable_NormalPriority as NormalPriority,
	unstable_shouldYield,
	unstable_cancelCallback
} from 'scheduler';
import { HookHasEffect, Passive } from './hostEffectTags';
import { SuspenseException, getSuspeseThenable } from './thenable';
import { resetHooksOnUnwind } from './fiberHooks';
import { throwException } from './fiberThrow';
import { unwindWork } from './fiberUnwindWork';

let workInProgress: FiberNode | null = null;
// 本次更新的lane是什么
let wipRootRenderLane: Lane = NoLane;

// 多次执行commitRoot的时候只调度一次
let rootDoesHasPassiveEffects: boolean = false;

type RootExistStatus = number;
const RootInProgress = 0; // 工作中的状态
// 保存render阶段退出的时候的一个状态
const RootInComplete = 1; // 并发更新，中断执行，还没有执行完
const RootCompleted = 2; // render执行完了
const RootDidNotComplete = 3; // 由于挂起，当前是未完成的状态，不用进入commit阶段
let wipRootExitStatus: number = RootInProgress;

// 挂起的原因
type SuspendedReason = typeof NotSuspended | typeof SuspendedOnData;
// 没被挂起
const NotSuspended = 0;
// 由于请求数据的挂起
const SuspendedOnData = 1;
// wip被挂起了，但是为什么被挂起
let wipSuspendedReason: SuspendedReason = NotSuspended;
// 需要一个全局变量保存我们抛出的数据
let wipThrownValue: any = null;

function prepareFreshStack(root: FiberRootNode, lane: Lane) {
	// root.current指向HostRootFiber
	root.finishedLane = NoLane;
	root.finishedWork = null;
	workInProgress = createWorkInProgress(root.current, {});
	wipRootRenderLane = lane;
	// 在工作中了
	wipRootExitStatus = RootInProgress;
	wipSuspendedReason = NotSuspended;
	wipThrownValue = null;
}

// 下面这个方法是连接renderRoot和Container
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
	// TODO 调度功能
	const root = markUpdateFromFiberToRoot(fiber);
	markRootUpdated(root, lane);
	ensureRootIsScheduled(root);
}

// schedule阶段，也就是调度阶段入口
export function ensureRootIsScheduled(root: FiberRootNode) {
	// 找出优先级最高的那个update
	const updateLane = getNextLane(root);
	const existingCallback = root.callbackNode;
	if (updateLane === NoLane) {
		// 没有lane对应没有update
		if (existingCallback !== null) {
			unstable_cancelCallback(existingCallback);
		}
		root.callbackNode = null;
		root.callbackPriority = NoLane;
		return;
	}

	const curPriority = updateLane;
	const prevPriority = root.callbackPriority;
	if (curPriority === prevPriority) {
		return;
	}
	// 走到这一步肯定是发现有更高优先级的任务了，那么就得取消之前的任务
	if (existingCallback !== null) {
		unstable_cancelCallback(existingCallback);
	}

	let newCallbackNode = null;

	if (__DEV__) {
		console.log(
			`在${updateLane === SyncLane ? '微' : '宏'}任务中调度，优先级`,
			updateLane
		);
	}

	if (updateLane === SyncLane) {
		// 同步优先级，用微任务调度
		/**
		 *
		 * 针对这个例子
		 * setState(n+1)
		 * setState(n+1)
		 * setState(n+1)
		 * 每次的setState都会执行ensureRootIsScheduled
		 * 因此syncQueue就是
		 * [performSyncWorkOnRoot,performSyncWorkOnRoot,performSyncWorkOnRoot]
		 * scheduleMicroTask在也会执行三次，但是在后面两次，isFlushingSyncQueue为true就走不进去了
		 */
		console.log('=======')
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他优先级用宏任务调度
		const schedulerPriority = lanesToSchedulerPriority(updateLane);
		newCallbackNode = schedulerCallback(
			schedulerPriority,
			// @ts-ignore
			performConcurrentWorkOnRoot.bind(null, root)
		);
	}

	root.callbackNode = newCallbackNode;
	root.callbackPriority = curPriority;
}

export function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

// 从当前的fiber一直往上查找根fiber对应的stateNode
function markUpdateFromFiberToRoot(fiber: FiberNode) {
	let node = fiber;
	let parent = node.return;
	while (parent !== null) {
		node = parent;
		parent = node.return;
	}
	if (node.tag === HostRoot) {
		return node.stateNode;
	}
	return null;
}

// 并发更新的入口
function performConcurrentWorkOnRoot(
	root: FiberRootNode,
	didTimeout: boolean
): any {
	// 这里需要处理一种情况
	/**
	 *
	 * function App() {
	 * 	useEffect(()=>{
	 *     //  并发更新开始的时候，如果在useEffect中有触发更新，如果这个更新的优先级很高，高到比当前并发更新的任务的优先级还高，那么
	 * 当前这个更新需要被打断，然后重新开始useEffect里面更高优先级的调度，也就是说useEffect的执行可能会触发更新，我们得比较一下它的更新
	 * 和当前正在并发更新的任务的优先级谁比较高
	 * 		updateXXX
	 * 	},[])
	 * }
	 */
	const curCallback = root.callbackNode;
	const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffect);
	// 执行了副作用触发了更新，可能会生成新的callbackNode
	if (didFlushPassiveEffect) {
		if (root.callbackNode !== curCallback) {
			//走到这里代表了副作用触发了更新优先级高于当前正在并发更新的任务
			return;
		}
	}

	const lane = getNextLane(root);
	const curCallbackNode = root.callbackNode;
	if (lane === NoLane) {
		return null;
	}
	const needSync = lane === SyncLane || didTimeout;
	//render阶段，这里对应demo里面的while循环
	const exitStatus = renderRoot(root, lane, !needSync);

	// 这里就不用ensureRootIsScheduled了，因为下面RootCompleted的时候也会执行commitRoot，commitRoot里面也有ensureRootIsScheduled
	// 这里相当于demo中的这一段
	/**
	 * const prevCallback = curCallback;
	 *  重新开始新一轮的调度
	schedule();
	const newCallback = curCallback;
	*/
	// ensureRootIsScheduled(root);

	switch (exitStatus) {
		case RootInComplete:
			// 中断
			if (root.callbackNode !== curCallbackNode) {
				// 代表了有一个更高优先级的更新，那么直接return null，因为上面的ensureRootIsScheduled已经开启了一个更高优先级的调度
				return null;
			}
			return performConcurrentWorkOnRoot.bind(null, root);
		case RootCompleted:
			/**
		 * 在React的更新过程中，分为两个阶段：Render（渲染）阶段和Commit（提交）阶段。
Render阶段就是将要更新什么计算出来，这一步可以是异步的，可以被中断。当React在执行这个阶段时，会创建work in progress tree（进行中的工作树），来记录新的状态下应该有的DOM结构。
而Commit阶段则是将渲染阶段计算出来的结果渲染出来，此阶段会改变DOM，且一旦开始就不能中断，直到所有的更新都应用到DOM上，以确保用户界面的一致性。这也正是为什么称为"Commit"（提交）的原因，这个阶段的任务一旦开始，就要被一次性完成，不会被打断。
简单说，Commit阶段就是“真实DOM”的更新阶段，所以它是不能被打断的，防止出现界面不一致的情况。
		*/
			const finishedWork = root.current.alternate;
			root.finishedWork = finishedWork;
			wipRootRenderLane = NoLane;
			// 保存本次更新消费的lane
			root.finishedLane = lane;
			// 接下来就可以根据wip fiberNode树，和树中的flags，执行具体的DOM操作
			commitRoot(root);
			break;

		case RootDidNotComplete:
			// 没完成的话，那就重新调度一下
			wipRootRenderLane = NoLane;
			markRootSuspended(root, lane);
			ensureRootIsScheduled(root);
			break;
		default:
			if (__DEV__) {
				console.warn('还未实现并发更新结束状态');
			}
			break;
	}
}
// 同步更新的入口
function performSyncWorkOnRoot(root: FiberRootNode) {
	const nextLane = getNextLane(root);
	if (nextLane !== SyncLane) {
		// 其他比SyncLane低的优先级或者NoLane
		ensureRootIsScheduled(root);
		return;
	}

	const exitStatus = renderRoot(root, nextLane, false);

	switch (exitStatus) {
		case RootCompleted:
			// 完成的状态
			const finishedWork = root.current.alternate;
			root.finishedWork = finishedWork;
			wipRootRenderLane = NoLane;
			// 保存本次更新消费的lane
			root.finishedLane = nextLane;
			// 接下来就可以根据wip fiberNode树，和树中的flags，执行具体的DOM操作
			commitRoot(root);
			break;
		case RootDidNotComplete:
			// 同步任务
			// 由于挂起，当前是未完成的状态，不用进入commit阶段
			wipRootRenderLane = NoLane;
			markRootSuspended(root, nextLane);
			ensureRootIsScheduled(root);
			break;
		default:
			if (__DEV__) {
				console.warn('还未实现同步更新结束状态');
			}
			break;
	}
}

function renderRoot(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
	if (__DEV__) {
		console.warn(`开始${shouldTimeSlice ? '并发' : '同步'}更新`);
	}

	if (wipRootRenderLane !== lane) {
		// 这里不应该每次进来都进行初始化，因为并发更新也有可能执行这个renderRoot，
		// 而并发更新有可能是一个中断然后再继续的过程
		// 初始化，并发更新的wipRootRenderLane和lane是一样的，所以不会初始化
		// 这句话怎么理解？wipRootRenderLane是在prepareFreshStack里面赋值的，当renderRoot结束之后，wipRootRenderLane会被重置为NoLane
		// 在同步更新的时候wipRootRenderLane是NoLane，lane是SyncLane，这时候是不想等的，就会执行prepareFreshStack
		// 而并发更新的时候wipRootRenderLane一直都是SyncLane，不会变，因此不会再执行prepareFreshStack
		prepareFreshStack(root, lane);
	}

	do {
		try {
			if (wipSuspendedReason !== NotSuspended && workInProgress !== null) {
				// 这里要考虑一下是不是得进入unwind的流程了
				const thrownValue = wipThrownValue;
				wipSuspendedReason = NotSuspended;
				wipThrownValue = null;
				// unwind
				throwAndUnwindWorkLoop(root, workInProgress, thrownValue, lane);
			}
			// shouldTimeSlice是否需要并发执行
			shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
			//到这里有可能是整个workLoop执行完了break，也有可能是中断了break
			break;
		} catch (e) {
			if (__DEV__) {
				console.warn('workLoop发生错误', e);
			}
			handleThrow(root, e);
			workInProgress = null;
		}
	} while (true);

	if (wipRootExitStatus !== RootInProgress) {
		// 没有在工作中
		return wipRootExitStatus;
	}

	// 如果在workLoopConcurrent的过程中，出现了更高优先级的任务，或者时间切片的时间已经用尽，那么里面的while循环就会被中断
	// 中断执行
	if (shouldTimeSlice && workInProgress !== null) {
		return RootInComplete;
	}
	if (!shouldTimeSlice && workInProgress !== null) {
		console.error('render阶段结束时wip不应该不为null');
	}
	// render阶段执行完
	return RootCompleted;
}

function throwAndUnwindWorkLoop(
	root: FiberRootNode,
	// 当前挂起的fiber节点
	unitOfWork: FiberNode,
	thrownValue: any,
	lane: Lane
) {
	// 1. 重置FC的全局变量
	resetHooksOnUnwind();
	// 2. 请求返回后重新触发更新
	throwException(root, thrownValue, lane);
	// 3. unwind
	// 如何精确地控制我们的unwind操作只进行到离我们最近的Suspense上
	// 当我们抛出错误的时候，我们在抛出错误的这个组件先找到最近的Suspense，然后给他的flags标记一个shouldCapture，
	// 然后就开始unwind流程，一级一级往上找，直到找到了标记了shouldCapture的Suspense
	// 当我们找到这个被标记了shouldCapture的Suspense之后，我们把shouldCapture变为DidCapture，然后从这个Suspense又开始beginWork

	unwindUnitOfWork(unitOfWork);
}

function unwindUnitOfWork(unitOfWork: FiberNode) {
	let inCompleteWork: FiberNode | null = unitOfWork;
	do {
		// 一直往上找，找离当前抛出异常的组件最近的Suspense
		const next = unwindWork(inCompleteWork);
		if (next !== null) {
			// 找到了那个Suspense，然后赋值给workInProgress，接下来就会从这里开始beginWork
			workInProgress = next;
			return;
		}

		const returnFiber = inCompleteWork.return as FiberNode;
		if (returnFiber !== null) {
			// 因为unwind流程，所以我们要把之前标记的一些副作用给清除，因为这个过程是回溯的， 我们要重新beginWork
			returnFiber.deletions = null;
		}
		inCompleteWork = returnFiber;
	} while (inCompleteWork !== null);

	// 跑到这里的话，代表我们在函数组件中使用了use，但是我们没有Suspense包裹住组件
	wipRootExitStatus = RootDidNotComplete;
	workInProgress = null;
}
function handleThrow(root: FiberRootNode, thrownValue: any) {
	// 这里可以处理很多种错误
	// 比如Error Boundary
	// 但是我们目前只处理我们自定义的错误
	if (thrownValue === SuspenseException) {
		thrownValue = getSuspeseThenable();
		wipSuspendedReason = SuspendedOnData;
	}
	wipThrownValue = thrownValue;
}
function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}
	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}
	const lane = root.finishedLane;
	if (lane === NoLane) {
		console.error('commit阶段finishedLane不应该是NoLane');
	}
	// 执行一些重置操作
	root.finishedWork = null;
	root.finishedLane = NoLane;
	markRootFinished(root, lane);

	if (
		(finishedWork.flags & PassiveMask) !== NoFlags ||
		(finishedWork.subtreeFlags & PassiveMask) !== NoFlags
	) {
		// 表明当前这棵fiber树中存在函数组件需要执行useffect回调的
		if (!rootDoesHasPassiveEffects) {
			rootDoesHasPassiveEffects = true;
			// 调度副作用
			schedulerCallback(NormalPriority, () => {
				// 这个回调函数会在commit阶段完成以后异步执行副作用
				flushPassiveEffects(root.pendingPassiveEffect);
				return;
			});
		}
	}

	// 判断是否存在3个子阶段需要执行的操作
	// 这个时候需要判断root的flags和root的subtreeFlags
	const substreeHasEffect =
		(finishedWork.subtreeFlags & MutationMask) !== NoFlags;
	const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;
	if (substreeHasEffect || rootHasEffect) {
		// 阶段1/3:beforeMutation
		/**
		 * 这个阶段主要是调用getSnapshotBeforeUpdate，这个生命周期函数发生在render之后，
		 * 实际DOM变化之前，用来捕获render之前的某个DOM状态。
		 */

		// 阶段2/3:mutation
		// fiber树切换的操作在mutation之后，在layout之前
		/**
		 * 这个阶段主要执行实际的DOM更新操作，React会遍历effect list（一种相关副作用的链表结构），
		 * 进行增加，删除和更新DOM节点的操作。
		 */
		commitMutationEffects(finishedWork, root);

		// 当我们mutation执行完之后我们会执行fiber树的切换，所以在layout阶段，我们的wip fiber已经变成了currentFiber
		root.current = finishedWork;

		// 阶段3/3:layout
		/**
		 * 这个阶段主要执行可能会导致额外渲染的工作，包括执行useLayoutEffect（类似componentDidMount和componentDidUpdate），
		 * 和生命周期函数componentDidMount，componentDidUpdate。
		 * useLayoutEffect会在浏览器layout操作之后，下一次重绘之前，同步调用它的回调函数。
		 */
		commitLayoutEffects(finishedWork, root);
	} else {
		root.current = finishedWork;
	}

	rootDoesHasPassiveEffects = false;
	ensureRootIsScheduled(root);
}

// 这里是执行effect的回调
function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
	// 这个字段用来标识当前是否有回调
	let didFlushPassiveEffect = false;
	// 这里要执行完所有destroy回调，再执行create回调
	pendingPassiveEffects.unmount.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListUnmount(Passive, effect);
	});
	pendingPassiveEffects.unmount = [];
	// 先执行上一次的destroy
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});
	// 再执行create
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListCreate(Passive | HookHasEffect, effect);
	});
	pendingPassiveEffects.update = [];
	// 此时再useEffect中可能还有新的setState，这个时候需要继续处理更新流程
	flushSyncCallbacks();
	return didFlushPassiveEffect;
}

// 这个是不可中断的
function workLoopSync() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}
// 可中断的
function workLoopConcurrent() {
	// shouldYield会告诉我们时间切片的时间是否用尽，用尽了就中断执行
	while (workInProgress !== null && !unstable_shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane);
	fiber.memoizedProps = fiber.pendingProps;
	if (next === null) {
		// 说明已经遍历到最底层了，应该执行completeWork了
		completeUnitOfWork(fiber);
	} else {
		workInProgress = next;
	}
}

function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber;
	do {
		completeWork(node);
		const sibling = node.sibling;
		if (sibling !== null) {
			workInProgress = sibling;
			return;
		}
		node = node?.return;
		workInProgress = node;
	} while (node != null);
}
