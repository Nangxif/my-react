import {  useRef } from 'react';
import ReactDOM from 'react-dom/client';

// // function App() {
// // 	const [num, setNum] = useState(100);
// // 	window.setNum = setNum;
// // 	return num === 3 ? <Child /> : <div>{num}</div>;

// // 	// return (
// // 	// 	<div>
// // 	// 		<span>123</span>
// // 	// 	</div>
// // 	// );
// // }
// // function Child() {
// // 	return <span>big-react</span>;
// // }

// // function App() {
// // 	const [num, setNum] = useState(100);
// // 	return (
// // 		<div
// // 			onClickCapture={(e) => {
// // 				e.stopPropagation();
// // 				console.log(222);
// // 			}}
// // 		>
// // 			<div
// // 				onClickCapture={() => {
// // 					console.log(111);
// // 				}}
// // 			>
// // 				{num}
// // 			</div>
// // 		</div>
// // 	);
// // }
// // function App() {
// // 	const [num, setNum] = useState(100);
// // 	const arr =
// // 		num % 2 === 0
// // 			? [<li key="1">1</li>, <li key="2">2</li>, <li key="3">3</li>]
// // 			: [<li key="3">3</li>, <li key="2">2</li>, <li key="1">1</li>];
// // 	return <div onClick={() => setNum(num + 1)}>{arr}</div>;
// // }
// // function App() {
// // 	const [num, setNum] = useState(100);
// // 	return (
// // 		<ul onClick={() => setNum(num + 1)}>
// // 			{num % 2 === 0 ? <li>3</li> : <>4</>}
// // 		</ul>
// // 	);
// // }
// // function App() {
// // 	const [num, setNum] = useState(100);
// // 	return (
// // 		<ul
// // 			onClickCapture={() => {
// // 				setNum((num) => {
// // 					return num + 1;
// // 				});
// // 				setNum((num) => {
// // 					return num + 1;
// // 				});
// // 				setNum((num) => {
// // 					return num + 1;
// // 				});
// // 			}}
// // 		>
// // 			{num}
// // 		</ul>
// // 	);
// // }

// // function App() {
// // 	return (
// // 		<>
// // 			<>
// // 				<div />
// // 			</>
// // 		</>
// // 	);
// // }

// function Child() {
// 	return <div ref={(dom) => console.warn('dom is:', dom)}>child</div>;
// }
// function App() {
// 	const [isDel, del] = useState(false);
// 	const divRef = useRef(null);
// 	console.warn('render divRef', divRef.current);
// 	useEffect(() => {
// 		console.warn('useEffect divRef', divRef.current);
// 	}, []);

// 	return (
// 		<div ref={divRef} onClick={() => del(true)}>
// 			{isDel ? null : <Child />}
// 		</div>
// 	);
// }

// const root = document.querySelector('#root');
// ReactDOM.createRoot(root).render(<App />);


import React, { useEffect, useState } from "react";
// const Child1 = () => {
//   useEffect(() => {
//     console.log("Child1 useEffect create有deps");
//     return () => {
//       console.log("Child1 useEffect destroy有deps");
//     };
//   }, []);
//   return <div>child1</div>;
// };
// const Child2 = () => {
//   useEffect(() => {
//     console.log("Child2 useEffect create有deps");
//     return () => {
//       console.log("Child2 useEffect destroy有deps");
//     };
//   }, []);
//   return <div>child2</div>;
// };
// const Child3 = () => {
//   useEffect(() => {
//     console.log("Child3 useEffect create有deps");
//     return () => {
//       console.log("Child3 useEffect destroy有deps");
//     };
//   }, []);
//   return <div>child3</div>;
// };
// const App = () => {
//   const [show, setShow] = useState(true);
//   useEffect(() => {
//     console.log("App useEffect create没有deps");
//   });
//   useEffect(() => {
//     console.log("App useEffect create有deps");
//     return () => {
//       console.log("App useEffect destroy有deps");
//     };
//   }, [show]);

//   return (
//     <div onClick={() => setShow(!show)}>
//       {show ? (
//         <>
//           <Child1 />
//           <Child2 />
//         </>
//       ) : (
//         <Child3 />
//       )}
//     </div>
//   );
// };
// const App = () => {
//   const [num, setNum] = useState(0);
//   return (
//     <div
//       onClick={() => {
//         setNum(num + 1);
//         setNum(num + 1);
//         setNum(num + 1);
//         setTimeout(() => {
//           console.log(num);
//         });
//       }}
//     >
//       {num}
//     </div>
//   );
// };
// const App = () => {
//   const [num, setNum] = useState(0);
//   console.log("render");
//   return (
//     <div
//       onClick={() => {
//         setTimeout(() => {
//           console.log("render1");
//           setNum(num + 1);
//         });
//         setTimeout(() => {
//           console.log("render2");
//           setNum(num + 1);
//         });
//         setTimeout(() => {
//           console.log("render3");
//           setNum(num + 1);
//         });
//         setTimeout(() => {
//           console.log(num);
//         });
//       }}
//     >
//       {num}
//     </div>
//   );
// };

function App() {
  const ref1 = useRef(null);
  const ref2 = useRef(null);
  useEffect(() => {
    ref1.current.addEventListener(
      "click",
      () => {
        console.log("ref1 origin capture");
      },
      true
    );
    ref1.current.addEventListener(
      "click",
      () => {
        console.log("ref1 origin bubble");
      },
      false
    );

    ref2.current.addEventListener(
      "click",
      () => {
        console.log("ref2 origin capture");
      },
      true
    );
    ref2.current.addEventListener(
      "click",
      () => {
        console.log("ref2 origin bubble");
      },
      false
    );
  }, []);
  return (
    <div
      onClick={() => {
        console.log("ref1 bubble");
      }}
      onClickCapture={() => {
        console.log("ref1 capture");
      }}
      ref={ref1}
    >
      <div
        onClick={() => {
          console.log("ref2 bubble");
        }}
        onClickCapture={() => {
          console.log("ref2 capture");
        }}
        ref={ref2}
      >
        点击
      </div>
    </div>
  );
  // return <App />;
}
const root = document.querySelector("#root");
ReactDOM.createRoot(root).render(<App />);