# 初探reconciler

reconciler是React核心逻辑所在的模块，中文名叫协调器，协调器（reconciler）在就是diff算法的意思

reconciler有什么用？
jquery工作原理（过程驱动）：
调用 显示
jquery ---> 宿主环境API ---> 真实UI

当我们拥有前端框架之后呢，工作方式就发生了改变，前端框架结构与工作原理（状态驱动）：

开发者需要做的事情就是描述UI
描述UI的方法 运行时核心模块
react对应jsx --编译优化-->react对应reconciler 调用 显示
vue对应模版语法 ---------->vue对应renderer ---> 宿主环境API ---> 真实UI

- 对于react来说，它消费的是jsx，不支持模板语法
- react没有编译优化，react是一个纯运行时的前端框架
- 开放通用的API供不同的宿主环境使用

# 核心模块消费JSX过程

核心模块操作的数据结构是？
当前已知的数据结构：ReactElement(JSX转换)
ReactElement如果作为核心模块操作的数据结构，会存在哪些问题：

- 无法表达节点之间的关系
- 字段有限，不好拓展（比如无法表达当前这个ReactElement接下来的状态会发生什么样的变化）
  所以，需要一种新的数据结构，他的特点：
- 介于ReactElement与真实UI节点之间
- 能够表达节点之间的关系（父子关系还是兄弟节点关系）
- 方便拓展（不仅作为数据存储单元，也能作为工作单元）
  这就是FiberNode(虚拟DOM在React中的实现)
  虚拟DOM在vue中的实现叫VNode

当前我们了解的节点类型：

- JSX
- ReactElement
- FiberNode
- DOMElement

# renconciler的工作方式

对于同一个节点，比较ReactElement与fiberNode，生成子fiberNode，并根据比较的结果生成不同标记（插入，删除，移动……），对应不同宿主环境API对执行

比如，挂载<div></div>
// ReactElement <div></div>
jsx("div")
// 对应fiberNode
null
// 生成子fiberNode
// 对应标记
Placement

将<div></div>更新为<p></p>

// ReactElement <p></p>
jsx("p")
// 对应fiberNode
FiberNode(type: "div")
// 生成子fiberNode
// 对应标记
Deletion Placement

当所有ReactElement比较完之后，会生成一棵fiber树，一共会存在两棵fiber树：

- current: 与试图中真实UI对应的fiber树
- workInProgress: 触发更新后，正在reconciler中计算的fiberNode树

当我们的workInProgress这棵树生成完了以后，就会生成很多标记，这些标记就对应了宿主环境api的执行，执行完之后真实的UI就会更新，更新完之后workInProgress树就会变成current树，
这叫双缓存技术

JSX的消费顺序
以DFS深度优先遍历的顺序遍历ReactElement，这意味着：

- 如果有子节点，遍历子节点
- 如果没有子节点，遍历兄弟节点
  这是个递归的过程，存在递，归两个段
- 递：对应beginWork
- 归：对应completeWork

更新
常见的触发更新的方式：

- ReactDOM.createRoot().render
  （或者老版的ReactDOM.render）
- this.setState
- useState的dispatch方法
  我们希望实现一套统一的更新机制，他的特点是
- 兼容上述触发更新的方式
- 方便后续扩展（优先级机制）

更新机制的组成部分

- 代表更新的数据结构 ---Update
- 消费update的数据结构 ---UpdateQueue

# 初探mount流程

更新流程的目的：

- 生成wip fiberNode树
- 标记副作用flags
  更新流程的步骤：
- 递：beginWork
- 归：completeWork
  beginWork
  对于如下结构的createElememt

```html
<a>
	<b />
</a>
```

当进入A的beginWork时，通过对比B current fiberNode与B createElement，生成B对应wip fiberNode
在此过程中最多会标记两类与【结构变化】相关的flags:

- Placement
  比如插入： a -> ab
  比如移动：abc ->bca
- ChildDeletion
  删除：ul>li*3 -> ul>li*1

不包含与【属性变化】相关的flag:
Update
<img title="鸡"/> -> <img title="你太美"/>
实现与Host相关节点的beginWork
首先，为开发环境增加**DEV**标识，方便Dev包打印更多信息

```
pnpm i  -D -w @rollup/plugin-replace
```

HostRoot的beginWork工作流程：

1. 计算状态的最新值
2. 创造子fiberNode
   HostComponent的beginWork工作流程：
3. 创造子fiberNode
   HostText没有beginWork工作流程（因为他没有子节点）

beginWork性能优化策略
考虑如下结构的createElement:

<div>
    <p>练习时长</p>
    <span>两年半</span>
</div>
理论上mount流程完毕之后包含的flags:

- 两年半 Placement
- span Placement
- 练习时长 Placement
- p Placement
- div Placement
  相比于执行5次Placement，我们可以构建好【离屏DOM树】后，对div执行一次 Placement操作

completeWork
需要解决的问题：

- 对于Host类型FiberNode：构建离屏DOM树
  为什么是在completeWork的时候才构建离屏树，因为在这个阶段才是从下往上的，那么我们就可以获取到最深层的子节点，
  那么每次往上的过程，我们就可以把子节点插入到父节点中，然后再把父节点插入到爷爷节点中，这样依次往上，就可以构建一棵离屏的dom树
- 标记Update flag

completeWork性能优化策略
flags分布在不同的fiberNode中，如何快速找到他们？
我们在beginWork标记了Placement的flag，当我们的递归阶段完成了，回到了我们整个应用的跟节点，那么我们会得到一棵workInProgress树，以及这棵workInProgress树里面某一些节点会被标记上副作用，那么接下来我们肯定要找到哪些节点被标记上了副作用，并对他执行相对应的操作，那么这个寻找的过程，如果我们继续深度优先遍历这个树的话，显然性能不是很高，因此，我们可以利用completeWork向上遍历的流程，将子fiberNode的flags冒泡到父fiberNode

# 初探ReactDOM

react内部3个阶段：

- schedule阶段（调度阶段，调度的是更新）
- render阶段（beginWork completeWork）
- commit阶段（commitWork）
  commit阶段的3个子阶段
- beforeMutation阶段
- mutation阶段
- layout阶段
  当前commit阶段要执行的任务

1. fiber树的切换
2. 执行Placement对应操作
   需要注意的问题，考虑如下JSX，如果span含有flag，该如何找到它：
   <App>
   <div>
   <span>只因</span>
   </div>
   </App>




# 实现useState
hook脱离FC上下文，仅仅是普通函数，如何让他拥有感知上下文的能力？
比如说：
* hook如何知道在另一个hook的上下文环境内执行？
```javascript
function App() {
   useEffect(()=>{
    // useState执行时怎么知道
    useState(0)
   },[])
}
```
* hook怎么知道当前是mount还是update？
解决方案：在不同上下文中调用的hook不是同一个函数

hook如何知道自身数据保存在哪里
```javascript
function App() {
  // 执行useState为什么能返回正确的值
  const [num] = useState(0)
}
```
答案：可以记录当前正在render的FC对应的fiberNode，在fiberNode中保存hook数据

