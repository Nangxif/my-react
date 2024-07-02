// 递归中的递阶段

import { ReactElementType } from '../../shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import {
	FiberNode,
	OffScreenProps,
	createFiberFromFragment,
	createFiberFromOffScreen,
	createWorkInProgress
} from './fiber';
import { pushProvider } from './fiberContext';
import {
	ChildDeletion,
	DidCapture,
	NoFlags,
	Placement,
	Ref
} from './fiberFlags';
import { renderWithHooks } from './fiberHooks';
import { Lane } from './fiberLanes';
import { pushSuspeseHandler } from './suspenseContext';
import { UpdateQueue, processUpdateQueue } from './updateQueue';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText,
	OffScreenComponent,
	SuspenseComponent
} from './workTags';

export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	// 比较，最终返回子fiberNode
	switch (wip.tag) {
		case HostRoot:
			// 这个传renderLane是因为里面会触发更新
			return updateHostRoot(wip, renderLane);
		case HostComponent:
			return updateHostComponent(wip);
		case HostText:
			// 如果beginWork一直执行到文本节点的话，那么文本节点是没有子节点的
			// 也说明了更新流程的递归中的递阶段，一直递到叶子节点为HostText的时候就没办法继续往下了，接下来就要开始归阶段
			return null;
		case FunctionComponent:
			// 这个传renderLane是因为里面也会触发更新
			return updateFunctionComponent(wip, renderLane);
		case Fragment:
			return updateFragment(wip);
		case ContextProvider:
			return updateContextProvider(wip);
		case SuspenseComponent:
			return updateSuspenseComponent(wip);
		case OffScreenComponent:
			return updateOffscreenComponent(wip);
		default:
			if (__DEV__) {
				console.warn('beginwork未实现的类型');
			}
			break;
	}
	return null;
};

function updateSuspenseComponent(wip: FiberNode) {
	const current = wip.alternate;
	const nextProps = wip.pendingProps;

	let showFallback = false;

	// 当前是正常流程还是挂起流程
	const didSuspend = (wip.flags & DidCapture) !== NoFlags; // 为true表示挂起
	if (didSuspend) {
		showFallback = true;
		wip.flags &= ~DidCapture;
	}
	// 正常的children
	const nextPrimaryChildren = nextProps.children;
	// fallback
	const nextFallbackChildren = nextProps.fallback;

	pushSuspeseHandler(wip);

	if (current === null) {
		//mount
		if (showFallback) {
			// 挂起
			return mountSuspenseFallbackChildren(
				wip,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 正常
			return mountSuspensePrimaryChildren(wip, nextPrimaryChildren);
		}
	} else {
		// update
		if (showFallback) {
			// 挂起
			return updateSuspenseFallbackChildren(
				wip,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 正常
			return updateSuspensePrimaryChildren(wip, nextPrimaryChildren);
		}
	}
}

// update时正常流程
function updateSuspensePrimaryChildren(wip: FiberNode, primaryChildren: any) {
	const current = wip.alternate;
	const currentPrimaryChildFragment = current?.child as FiberNode;
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment?.sibling;
	const primaryChildProps: OffScreenProps = {
		mode: 'visible',
		children: primaryChildren
	};
	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);
	primaryChildFragment.return = wip;
	// 不需要管fallback，直接移除掉，要的话再创建
	primaryChildFragment.sibling = null;
	// 既然我们要移除fallback，那么我们得看一下它的current在不在
	if (currentFallbackChildFragment !== null) {
		// 在的话要移除掉
		const deletions = wip.deletions;
		if (deletions === null) {
			wip.deletions = [currentFallbackChildFragment];
			wip.flags |= ChildDeletion;
		} else {
			wip.deletions?.push(currentFallbackChildFragment);
		}
	}

	return primaryChildFragment;
}

// update时挂起流程
function updateSuspenseFallbackChildren(
	wip: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	const current = wip.alternate;
	const currentPrimaryChildFragment = current?.child as FiberNode;
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment?.sibling;
	const primaryChildProps: OffScreenProps = {
		mode: 'hidden',
		children: primaryChildren
	};

	// 复用的primaryChildFragment
	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);
	let fallbackChildFragment;
	if (currentFallbackChildFragment !== null) {
		// 存在的话就可以复用
		fallbackChildFragment = createWorkInProgress(
			currentFallbackChildFragment,
			fallbackChildren
		);
	} else {
		// 不存在的话就得创建
		fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);
		fallbackChildFragment.flags |= Placement;
	}
	fallbackChildFragment.return = wip;
	primaryChildFragment.return = wip;
	primaryChildFragment.sibling = fallbackChildFragment;
	wip.child = primaryChildFragment;
	return fallbackChildFragment;
}

// mount时正常流程
function mountSuspensePrimaryChildren(wip: FiberNode, primaryChildren: any) {
	const primaryChildProps: OffScreenProps = {
		mode: 'visible',
		children: primaryChildren
	};
	const primaryChildFragment = createFiberFromOffScreen(primaryChildProps);
	// 这个阶段就不需要fallbackChildFragment了
	wip.child = primaryChildFragment;
	primaryChildFragment.return = wip;
	return primaryChildFragment;
	// 为什么我们在这个阶段，也就是走OffScreen这条路的时候不创建Fragment对应的fiber呢？
	// 那是因为我们在使用Suspense的时候，我们完全不知道什么时候会使用到fallback，兴许用不上呢？
	// 我们完全可以等到需要用的时候才创建
}

// mount时挂起流程
/**
 * 什么情况下会进入这个阶段
 * mode从visible变成hidden的时候，此时Fragement的父组件Suspense已经挂载了
 * 我们在shouldTrackEffects为true的时候才会标记Placement，也就是只有update的时候shouldTrackEffects才为true
 * 但是对于Fragment来说还在mount阶段，即使要挂载，但是它的shouldTrackEffects一直无法为true，所以我们才需要手动添加副作用
 */
function mountSuspenseFallbackChildren(
	wip: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	const primaryChildProps: OffScreenProps = {
		mode: 'hidden',
		children: primaryChildren
	};
	const primaryChildFragment = createFiberFromOffScreen(primaryChildProps);
	const fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);

	fallbackChildFragment.flags |= Placement;

	primaryChildFragment.return = wip;
	fallbackChildFragment.return = wip;
	primaryChildFragment.sibling = fallbackChildFragment;
	wip.child = primaryChildFragment;
	return fallbackChildFragment;
}
// function mountSuspenseFallbackChildren() {}
function updateOffscreenComponent(wip: FiberNode) {
	const nextProps = wip.pendingProps;
	const nextChildren = nextProps.children;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}
function updateHostRoot(wip: FiberNode, renderLane: Lane) {
	// 对于首屏渲染的时候来说，肯定是还不存在的
	const baseState = wip.memoizedState;
	const updateQueue = wip.updateQueue as UpdateQueue<Element>;
	const pending = updateQueue.shared.pending;
	/**
	 * 保存Update的问题
	 * 按照我们下面直接把panding的做法，我们是相信取出来的pending在processUpdateQueue一定会被执行，
	 * 所以才将他清空，但是我们现在有了并发更新，我们的更新可能被打断，比如优先级较低的更新运行到一半如果有高优先级的更新出现，就会被打断
	 * 然后去执行高优先级的更新，那么此时低优先级的更新已经被置为null了，这显然是不对的了
	 * 考虑将update保存在current中，只要不进入commit阶段，current与wip不会互换，
	 * 所以保存在current中，即使多次执行render阶段，只要不进入commit阶段，都能从current中恢复数据
	 */
	/**
	 *  对于首屏渲染来说，这个是不会被打断的，会被打断的情况是出现在hook中，因此我们要去那边解决
	 */
	updateQueue.shared.pending = null;
	const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);

	const current = wip.alternate;

	if (current !== null) {
		// 即使从wip中取不到memoizedState，也可以从current里面取
		current.memoizedState = memoizedState;
	}
	wip.memoizedState = memoizedState;
	const nextChildren = wip.memoizedState;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

function updateHostComponent(wip: FiberNode) {
	// 对于首屏渲染的时候来说，肯定是还不存在的
	// <div></div>节点对应的reactElement来说的话，就是在children里面，而children就存放在props里面
	const nextProps = wip.pendingProps;
	const nextChildren = nextProps.children;
	markRef(wip.alternate, wip);
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

function updateFunctionComponent(wip: FiberNode, renderLane: Lane) {
	const nextChildren = renderWithHooks(wip, renderLane);
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

function updateFragment(wip: FiberNode) {
	// pendingProps里面有一个children属性
	const nextChildren = wip.pendingProps;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

function updateContextProvider(wip: FiberNode) {
	const providerType = wip.type;
	const context = providerType._context;
	const newProps = wip.pendingProps;
	pushProvider(context, newProps.value);
	const nextChildren = newProps.children;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

function reconcileChildren(wip: FiberNode, children?: ReactElementType) {
	//<A><B/></A>
	// 当进入A的beginWork时，通过对比B current fiberNode与B createElement，生成B对应wip fiberNode
	// 所以我们先获取current节点
	const current = wip.alternate;
	if (current !== null) {
		// current不为空，说明不是首屏渲染
		// update
		wip.child = reconcileChildFibers(wip, current?.child, children);
	} else {
		// 即将开始渲染之前只有workInProgress树，还没有current树
		// mount
		wip.child = mountChildFibers(wip, null, children);
	}
}

function markRef(current: FiberNode | null, workInProgress: FiberNode) {
	const ref = workInProgress.ref;

	if (
		(current === null && ref !== null) ||
		(current !== null && current.ref !== ref)
	) {
		// mount时，并且存在ref
		// 或者update时，ref引用发生变化
		workInProgress.flags |= Ref;
	}
}
