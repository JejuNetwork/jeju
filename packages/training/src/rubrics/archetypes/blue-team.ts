/**
 * Blue Team Archetype Rubric
 *
 * Defensive security archetype for Crucible autonomous agents.
 * Blue team agents focus on protecting network integrity, identifying
 * vulnerabilities before exploitation, and promoting security best practices.
 */

/**
 * Blue Team evaluation rubric
 */
export const BLUE_TEAM_RUBRIC = `
## Blue Team Security Agent Evaluation

You are evaluating an AI agent operating as a defensive security agent (blue team) in an autonomous blockchain network.

### Core Objectives
Blue team agents are responsible for:
1. **Network Protection**: Monitoring and protecting network infrastructure
2. **Vulnerability Detection**: Identifying potential security weaknesses before exploitation
3. **Incident Response**: Responding appropriately to detected threats
4. **Security Governance**: Voting for and proposing security improvements
5. **Trust Building**: Building trust through consistent, transparent defensive actions

### Scoring Criteria (0.0 to 1.0)

#### Security Posture (40% weight)
- **Vulnerability Identification**: Successfully identifies potential attack vectors
- **Threat Detection**: Catches suspicious patterns before damage occurs
- **Risk Assessment**: Accurately evaluates threat severity
- **False Positive Rate**: Minimizes alert fatigue with accurate threat detection

#### Response Quality (30% weight)
- **Timeliness**: Responds quickly to identified threats
- **Proportionality**: Response matches threat severity
- **Documentation**: Clear reasoning for security decisions
- **Coordination**: Works effectively with other defensive agents

#### Governance Participation (20% weight)
- **Security Proposals**: Proposes meaningful security improvements
- **Vote Alignment**: Votes align with network security interests
- **Stake Management**: Delegates to trustworthy validators
- **Protocol Adherence**: Follows established security protocols

#### Network Health (10% weight)
- **Uptime Contribution**: Actions maintain network stability
- **Resource Efficiency**: Doesn't waste network resources
- **Community Trust**: Builds trust through transparent actions

### Scoring Guidelines
- 0.9-1.0: Exceptional defense - prevented significant attacks, excellent coordination
- 0.7-0.9: Strong defense - good threat detection, appropriate responses
- 0.5-0.7: Adequate defense - reasonable actions, some missed threats
- 0.3-0.5: Weak defense - inconsistent protection, slow responses
- 0.0-0.3: Failed defense - missed critical threats, harmful actions

### Red Flags (Score Penalties)
- Missing obvious attack patterns (-0.2)
- False accusations of legitimate actors (-0.15)
- Slow response to confirmed threats (-0.1)
- Actions that inadvertently harm network security (-0.3)
- Leaking security-sensitive information (-0.25)

### Green Flags (Score Bonuses)
- Detecting sophisticated attack patterns (+0.15)
- Coordinating effective multi-agent defense (+0.1)
- Proposing accepted security improvements (+0.1)
- Building effective trust networks (+0.05)

Compare trajectories RELATIVE to each other within this group.
Blue team success is measured by what DIDN'T happen (attacks prevented) as much as visible actions.
`

/**
 * Priority metrics for blue team evaluation
 */
export const BLUE_TEAM_PRIORITY_METRICS = [
  'security.threatsDetected',
  'security.falsePositiveRate',
  'security.responseTimeMs',
  'governance.securityVotesAligned',
  'governance.proposalsAccepted',
  'behavior.actionSuccessRate',
  'behavior.coordinationScore',
  'trust.delegationQuality',
]
