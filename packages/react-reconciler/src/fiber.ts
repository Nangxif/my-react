import { Key, Props, ReactElementType, Ref, Wakeable } from 'shared/ReactTypes';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	OffScreenComponent,
	SuspenseComponent,
	WorkTag
} from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { Lane, Lanes, NoLane, NoLanes } from './fiberLanes';
import { Effect } from './fiberHooks';
import { CallbackNode } from 'scheduler';
import { REACT_PROVIDER_TYPE, REACT_SUSPENSE_TYPE } from 'shared/ReactSymbols';

export interface OffScreenProps {
	mode: 'visible' | 'hidden';
	children: any;
}
export class FiberNode {
	type: any;
	tag: WorkTag;
	key: Key;
	stateNode: any;
	ref: Ref;
	return: FiberNode | null;
	sibling: FiberNode | null;
	child: FiberNode | null;
	index: number;
	// 开始准备工作的时候的props
	pendingProps: Props;
	// 工作完了确定下来的props是什么
	memoizedProps: Props | null;
	memoizedState: any;
	alternate: FiberNode | null;
	// 对应的标记
	flags: Flags;
	// 子树中包含的flags
	subtreeFlags: Flags;
	lanes: Lanes;
	// 存放effect链表
	updateQueue: unknown;
	// 存放需要被删除的子fiber
	deletions: FiberNode[] | null;

	constructor(tag: WorkTag, pendingProps: Props, key?: Key) {
		// 实例的属性
		this.tag = tag;
		this.key = key || null;
		// fiber节点对应的真实节点
		this.stateNode = null;
		// 如果fiber节点的类型是FunctionComponent的话，那么type对应的就是()=>{}
		this.type = null;
		// 构成树状结构
		// 指向父fiberNode
		this.return = null;
		// 指向下一个兄弟fiberNode
		this.sibling = null;
		// 指向子fiberNode
		this.child = null;
		// <ul><li></li><li></li></ul>第一个li的index是0，第二个是1
		this.index = 0;
		this.ref = null as unknown as Ref;

		// 构成工作单元
		// 这个工作单元准备开始的时候的props是什么，也就是初始props
		this.pendingProps = pendingProps;
		// 这个工作单元工作完的时候的props是什么，也就是最终props
		this.memoizedProps = null;
		this.memoizedState = null;
		this.updateQueue = null;

		this.alternate = null;
		// 副作用
		this.flags = NoFlags;
		this.subtreeFlags = NoFlags;
		this.deletions = null;
		this.lanes = NoLanes;
	}
}

export interface PendingPassiveEffects {
	unmount: Effect[];
	update: Effect[];
}
export class FiberRootNode {
	container: Container;
	current: FiberNode;
	// 这个字段指向的是我们整个更新完成之后hostRootFiber
	finishedWork: FiberNode | null;
	// 代表所有未被消费的lane的集合
	pendingLanes: Lanes;
	// 代表本次消费的lane
	finishedLane: Lanes;
	// 等待被消费的effect
	pendingPassiveEffect: PendingPassiveEffects;
	// 上次调度任务的回调函数
	callbackNode: CallbackNode | null;
	// 上次调度任务的优先级
	callbackPriority: Lane;
	// WeakMap{wakeable: Set<Lane>}
	pingCache: WeakMap<Wakeable<any>, Set<Lane>> | null;
	// root下所有被挂起的更新的优先级
	suspendedLanes: Lanes;
	// 当前root下所有挂起的更新里面的被ping了的更新的优先级，pingLanes就是suspendedLanes的子集
	// 这样子我们每次ensureRootIsScheduled的时候获取优先级就不用只取最高优先级的了，因为总取最高优先级的lane有可能取到挂起的lane
	// 我们得等到这个挂起的lane被ping了之后再取
	pingedLanes: Lanes;
	constructor(container: Container, hostRootFiber: FiberNode) {
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
		this.pendingLanes = NoLanes;
		this.finishedLane = NoLanes;
		this.suspendedLanes = NoLanes;
		this.pingedLanes = NoLanes;
		this.pendingPassiveEffect = {
			unmount: [],
			update: []
		};
		this.callbackNode = null;
		this.callbackPriority = NoLane;
		this.pingCache = null;
	}
}

export const createWorkInProgress = (
	current: FiberNode,
	pendingProps: Props
): FiberNode => {
	// 因为react的更新采用了双缓存机制，所以，在创建一个workInProgress树的时候，
	// current树在经过一大堆的操作，最后还是会返回一个workInProgress树
	let wip = current.alternate;
	if (wip === null) {
		// 首屏渲染的时候，workInProgress就是null，当我们首屏渲染之后，下一次渲染的时候，就有workInProgress树了
		// mount
		wip = new FiberNode(current.tag, pendingProps, current.key);
		wip.stateNode = current.stateNode;

		wip.alternate = current;
		current.alternate = wip;
	} else {
		// update
		wip.pendingProps = pendingProps;
		// 接下来就要删除掉副作用，因为这些副作用是上一次更新的时候遗留下来的
		wip.flags = NoFlags;
		wip.subtreeFlags = NoFlags;
		wip.deletions = null;
	}
	wip.type = current.type;
	wip.updateQueue = current.updateQueue;
	wip.child = current.child;
	wip.memoizedProps = current.memoizedProps;
	wip.memoizedState = current.memoizedState;
	wip.ref = current.ref;
	return wip;
};

export function createFiberFromElement(element: ReactElementType): FiberNode {
	const { type, key, props, ref } = element;
	// 默认为函数式组件吧
	let fiberTag: WorkTag = FunctionComponent;
	if (typeof type === 'string') {
		// <div/> type: 'div'
		fiberTag = HostComponent;
	} else if (
		typeof type === 'object' &&
		type.$$typeof === REACT_PROVIDER_TYPE
	) {
		fiberTag = ContextProvider;
	} else if (type.$$typeof === REACT_SUSPENSE_TYPE) {
		fiberTag = SuspenseComponent;
	} else if (typeof type !== 'function' && __DEV__) {
		console.warn('未定义的type类型', element);
	}

	const fiber = new FiberNode(fiberTag, props, key);
	fiber.type = type;
	fiber.ref = ref;
	return fiber;
}

export const createFiberFromFragment = (
	element: any[],
	key: Key
): FiberNode => {
	const fiber = new FiberNode(Fragment, element, key);
	return fiber;
};

export const createFiberFromOffScreen = (
	pendingProps: OffScreenProps
): FiberNode => {
	const fiber = new FiberNode(OffScreenComponent, pendingProps, null);
	return fiber;
};
