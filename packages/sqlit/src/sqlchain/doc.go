
// Package sqlchain provides a blockchain implementation for database state tracking.
//
// Bucket hierarchical structure is as following:
//
// [ root ]
// |
// +-- [ sql-chain meta ]
// |   |
// |   +-- [ state ]: State
// |   |
// |   +-- [ block ]
// |   |   |
// |   |   +--- [ height1+hash1 ]: Block1
// |   |   +--- [ height2+hash2 ]: Block2
// |   |   +--- [ height3+hash3 ]: Block3
// |   |   |
// |   |   +--- ...
// |   |
// |   +-- [ query ]
// |       |
// |       +--- ...
// |       |
// |       +--- [ height 7 ]
// |       |    |
// |       |    +--- [ request ]
// |       |    |    |
// |       |    |    +--- [ header hash1 ]: Request1
// |       |    |    +--- [ header hash2 ]: Request2
// |       |    |    +--- [ header hash3 ]: Request3
// |       |    |    |
// |       |    |    +--- ...
// |       |    |
// |       |    +--- [ response ]
// |       |    |    |
// |       |    |    +--- [ header hash1 ]: Response1
// |       |    |    +--- [ header hash2 ]: Response2
// |       |    |    +--- [ header hash3 ]: Response3
// |       |    |    |
// |       |    |    +--- ...
// |       |    |
// |       |    +--- [ ack ]
// |       |         |
// |       |         +--- [ header hash1 ]: Ack1
// |       |         +--- [ header hash2 ]: Ack2
// |       |         +--- [ header hash3 ]: Ack3
// |       |         |
// |       |         +--- ...
// |       |
// |       |
// |       +--- [ height 8 ]
// |       |    |
// |       |    +--- [ request ]
// |       |    |    |
// |       |    |    +--- ...
// |       |    |
// |       |    +--- [ response ]
// |       |    |    |
// |       |    |    +--- ...
// |       |    |
// |       |    +--- [ ack ]
// |       |         |
// |       |         +--- ...
// |       |
// |       +--- [ height 9 ]
// |       |    |
// |       |    +--- [ request ]
// |       |    |    |
// |       |    |    +--- ...
// |       |    |
// |       |    +--- [ response ]
// |       |    |    |
// |       |    |    +--- ...
// |       |    |
// |       |    +--- [ ack ]
// |       |         |
// |       |         +--- ...
// |       |
// |       +--- ...
// |
// |-- [ other bucket ]
// |-- [ other bucket ]
// |-- [ other bucket ]
// |
// +-- ...
//
//
//
// Block producing:
//
//      blocks: Block-0               Block-1               Block-2               ...
//             (Genesis)              |                     |
//              |                     +-{q1, q2}            +-{q3, q5}            ...
//              |                     |                     |
//              +---------------------+---------------------+-------------------
//              |                     |                     |
//     queries: | q1       q2    q3   |        q4 q5    q6  |     q7              ...
//     \        | |\       |\    |\   |        |  |     |   |     |
//      \       | | \      | |   | +--|--+     |  +     +   +     +
//  (responses) | |  \     | |   |    |   \    |  |\    |\   \    |\
//        \     | |   |    | |   |    +    \   |  | +   | \   \   | \
//         \    | |   |    | |   |     \    \  |  | |   |  \   \  |  \
//        acks: | |   a1   | a2  |      +    a3|  | a5  |   a6  + |   a7          ...
//              | |   |    | |   |      |    | |  | |   |    \  | |    \
//              | |   |    | |   |      |    | |  | |   |     + | |     +
//              | |   |    | |   |      |    | |  | |   |     | | |     |
//      height: 0 +---+----+-+---+--- 1 +----+-+--+-+---+-- 2 +-+-+-----+-------- ...
//              |                     |                     |
//              [ ---- period-0 ---- )[ ---- period-1 ---- )[ ---- period-2 ---- )...
//
// q4 will expire after `config.QueryTTL` blocks; q5 and q6, which are acknowledged in
// period-2, will be included in the next block.
//
package sqlchain
