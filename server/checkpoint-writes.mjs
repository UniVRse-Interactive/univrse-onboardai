// Checkpoint saves during a chat turn (issue #70).
//
// LangGraph saves a run's checkpoints (put) and each finished node's writes
// (putWrites) in the background while later nodes run (its default "async"
// durability). @langchain/langgraph 1.4 keeps a derived promise per save that
// rethrows a failure and gets no handler until the run ends
// (PregelLoop._trackCheckpointerPromise in dist/pregel/loop.js, awaited by
// Promise.all in the finally of createAndRunLoop in dist/pregel/index.js). A
// save that failed while a node was still running, such as a Firestore timeout
// during a Gemini answer, was therefore an unhandled rejection, and Node ended
// the whole process.
//
// containCheckpointWrites(saver, { log }) -> { saver, begin(threadId) }
//   saver            the saver to compile the graph with. Its put and putWrites
//                    never reject; every other method is the wrapped saver's.
//   begin(threadId)  -> { end() } brackets one turn of that chat. The turn's
//                    first failed save is kept, and saves that start after it
//                    are skipped, so the chat keeps its last complete
//                    checkpoint. end() returns that failure (or null); the turn
//                    throws it once graph.invoke() has returned, by which time
//                    every save of the run has settled.
// A save that fails outside a turn (a run cut off by its abort signal goes on in
// the background after invoke() rejects) is logged by error name and code and
// dropped: its turn has already failed.
export function containCheckpointWrites(saver, { log = (line) => console.warn(line) } = {}) {
  const turns = new Map();
  async function save(config, write) {
    const turn = turns.get(config?.configurable?.thread_id);
    if (turn?.failure) return undefined;
    try {
      return await write();
    } catch (error) {
      if (turn && !turn.ended) turn.failure ??= error ?? new Error('Checkpoint save failed.');
      else
        log(
          'Chat checkpoint save dropped after its answer ended: ' +
            JSON.stringify({ name: error?.constructor?.name, code: error?.code }),
        );
      return undefined;
    }
  }
  const contained = Object.create(saver);
  contained.put = (config, ...rest) => save(config, () => saver.put(config, ...rest));
  contained.putWrites = (config, ...rest) => save(config, () => saver.putWrites(config, ...rest));
  return {
    saver: contained,
    begin(threadId) {
      const turn = { ended: false, failure: null };
      turns.set(threadId, turn);
      return {
        end() {
          turn.ended = true;
          if (turns.get(threadId) === turn) turns.delete(threadId);
          return turn.failure;
        },
      };
    },
  };
}
