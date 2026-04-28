<!-- Copyright 2017-2019 LinkedIn Corp. Licensed under the BSD 2-Clause License (the "License"). See License in the project root for license information. -->
<template>
  <div>
    <div class="alert alert-info" v-if='!hideHelperURL'>
      <b>URL ({{group}}, {{cluster}}):</b> <a target=_blank :href='url'>{{ url }}</a>
    </div>
    <div v-if='!loading'>
      <div class="alert alert-primary text-right">
        <button class="btn btn-primary" @click='getState()'>Refresh Executor State</button>
        <button :class="['btn', autoRefresh ? 'btn-success' : 'btn-outline-secondary']" @click='toggleAutoRefresh()'>
          Auto-Refresh {{ autoRefresh ? 'ON (30s)' : 'OFF' }}
        </button>
      </div>
    </div>
    <div v-if='error'>
      <exception :exception='errorData'></exception>
    </div>
    <div v-if='async'>
      <async-task :asyncData='asyncData'></async-task>
    </div>
    <div v-else-if='!loaded && loading'>
      <div class="text-center p-3"><div class="spinner-border text-primary" role="status"></div> Loading ...</div>
    </div>
    <div v-else>
      <div class="card-deck mb-3">
        <div class="card text-center">
          <div class="card-header">Executor</div>
          <div class="card-body">
            <p class="card-text">
            <span :class="['badge', ExecutorState.state && ExecutorState.state.match(/STOPPED|ERROR/) ? 'badge-danger': 'badge-success']">{{ ExecutorState.state }}</span>
            </p>
          </div>
        </div>
      </div>

      <!-- Triggered Task Info (shown for all in-progress/stopping states) -->
      <div v-if='isInProgressState' class="card mb-3">
        <div class="card-header" style="cursor:pointer" @click="showTriggeredTaskInfo = !showTriggeredTaskInfo">
          {{ showTriggeredTaskInfo ? '▼' : '▶' }} Triggered Task Info
        </div>
        <div class="card-body" v-show="showTriggeredTaskInfo">
          <table class="table table-sm table-bordered mb-0">
            <tbody>
              <tr v-if="ExecutorState.triggeredUserTaskId">
                <td><strong>User Task ID</strong></td>
                <td>{{ ExecutorState.triggeredUserTaskId }}</td>
              </tr>
              <tr v-if="ExecutorState.triggeredSelfHealingTaskId">
                <td><strong>Self-Healing Task ID</strong></td>
                <td>{{ ExecutorState.triggeredSelfHealingTaskId }}</td>
              </tr>
              <tr v-if="ExecutorState.triggeredTaskReason">
                <td><strong>Reason</strong></td>
                <td>
                  <div v-if="parsedTaskReason.prefix">{{ parsedTaskReason.prefix }}</div>
                  <table v-if="parsedTaskReason.entries.length" class="table table-sm table-bordered mb-0 mt-1">
                    <tbody>
                      <tr v-for="(entry, idx) in parsedTaskReason.entries" :key="idx">
                        <td><strong>{{ entry.key }}</strong></td>
                        <td>{{ entry.value }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <span v-if="!parsedTaskReason.entries.length && !parsedTaskReason.prefix">{{ ExecutorState.triggeredTaskReason }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Main execution card (shown for all in-progress/stopping states) -->
      <div v-if='isInProgressState' class="card">
        <div>
          <div class='card-header'>
            {{ ExecutorState.state | camelCase }}
          </div>
        </div>
        <div class='card-body'>
          <div>
            <button class="btn btn-primary" @click='stopProposalExecution'>Stop Proposal Execution</button>
            <button class="btn btn-secondary" @click='okDataStopProposalExecution = null'>Clear Response</button>
            <div v-if='errStopProsalExecution'>
              <exception :exception='errDataStopProposalExecution'></exception>
            </div>
            <div v-else>
              <pre>{{ okDataStopProposalExecution }}</pre>
            </div>
            <hr>
          </div>

          <!-- ===================== INTER-BROKER SECTION ===================== -->
          <div v-if="isInterBrokerState || isLeaderMovementState || isStoppingState">
            <h4 class="mt-2 mb-3">Inter-Broker Replica Movement Progress</h4>
            <div class="card-deck mb-3">
              <div class="card">
                <div class="card-header">
                  Total Data To Move
                </div>
                <div class="card-body">
                  <div v-if='ExecutorState.totalDataToMove'>
                    <div class="progress" style="height:20px">
                      <div class="progress-bar progress-bar-striped progress-bar-animated" :style="'width:' + ExecutorState.finishedDataMovement / ExecutorState.totalDataToMove * 100 + '%'">Done</div>
                    </div>
                  </div>
                  <h1 class="text-primary">{{ ExecutorState.totalDataToMove | formatUnits }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Finished Data Movement</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-success">{{ ExecutorState.finishedDataMovement | formatUnits }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Remaining Data</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-info">{{ ExecutorState.totalDataToMove - ExecutorState.finishedDataMovement | formatUnits }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">% Data Complete</div>
                <div class="card-body">
                  <h1 class="text-warning">{{ ExecutorState.totalDataToMove ? (ExecutorState.finishedDataMovement / ExecutorState.totalDataToMove * 100).toFixed(1) + '%' : '0%' }}</h1>
                </div>
              </div>
            </div>
            <div class="card-deck mb-3">
              <div class="card">
                <div class="card-header">
                  Total Partition Movements
                </div>
                <div class="card-body">
                  <div v-if='ExecutorState.numTotalPartitionMovements'>
                    <div class="progress" style="height:20px">
                      <div class="progress-bar progress-bar-striped bg-success" :style="'width:' + ExecutorState.numFinishedPartitionMovements / ExecutorState.numTotalPartitionMovements * 100 + '%'">Done</div>
                      <div class="progress-bar progress-bar-striped progress-bar-animated" :style="'width:' + getInProgressPartitionMovements.length / ExecutorState.numTotalPartitionMovements * 100 + '%'">In Progress</div>
                    </div>
                  </div>
                  <h1 class="text-primary">{{ ExecutorState.numTotalPartitionMovements | formatNumber }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Finished Partition Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-success">{{ ExecutorState.numFinishedPartitionMovements | formatNumber }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">In Progress Partition Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-warning">{{ getInProgressPartitionMovements.length | formatNumber }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Remaining Partition Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-info">{{ ExecutorState.numTotalPartitionMovements - ExecutorState.numFinishedPartitionMovements | formatNumber }}</h1></p>
                </div>
              </div>
            </div>
            <div class="card-deck mb-3">
              <div class="card">
                <div class="card-header">
                  Total Leadership Movements
                </div>
                <div class="card-body">
                  <div v-if='ExecutorState.numTotalLeadershipMovements'>
                    <div class="progress" style="height:20px">
                      <div class="progress-bar progress-bar-striped progress-bar-animated" :style="'width:' + ExecutorState.numFinishedLeadershipMovements / ExecutorState.numTotalLeadershipMovements * 100 + '%'">Done</div>
                    </div>
                  </div>
                  <h1 class="text-primary">{{ ExecutorState.numTotalLeadershipMovements | formatNumber }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Finished Leadership Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-success">{{ ExecutorState.numFinishedLeadershipMovements | formatNumber }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Remaining Leadership Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-info">{{ ExecutorState.numTotalLeadershipMovements - ExecutorState.numFinishedLeadershipMovements | formatNumber }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">% Leadership Complete</div>
                <div class="card-body">
                  <h1 class="text-warning">{{ ExecutorState.numTotalLeadershipMovements ? (ExecutorState.numFinishedLeadershipMovements / ExecutorState.numTotalLeadershipMovements * 100).toFixed(1) + '%' : '0%' }}</h1>
                </div>
              </div>
            </div>
            <!-- Inter-broker concurrency stats -->
            <div v-if="ExecutorState.maximumConcurrentInterBrokerPartitionMovementsPerBroker != null" class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Max Concurrent Inter-Broker Movements/Broker</div>
                <div class="card-body">
                  <h1 class="text-primary">{{ ExecutorState.maximumConcurrentInterBrokerPartitionMovementsPerBroker }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Min Concurrent Inter-Broker Movements/Broker</div>
                <div class="card-body">
                  <h1 class="text-primary">{{ ExecutorState.minimumConcurrentInterBrokerPartitionMovementsPerBroker }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Avg Concurrent Inter-Broker Movements/Broker</div>
                <div class="card-body">
                  <h1 class="text-primary">{{ ExecutorState.averageConcurrentInterBrokerPartitionMovementsPerBroker | formatDecimal }}</h1>
                </div>
              </div>
            </div>
            <div class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Aborting Partitions</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-primary">{{ ExecutorState.abortingPartitions }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Aborted Partitions</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-success">{{ ExecutorState.abortedPartitions }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Dead Partitions</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-info">{{ ExecutorState.deadPartitions }}</h1></p>
                </div>
              </div>
            </div>
            <!-- Inter-broker stopping stats -->
            <div v-if="isStoppingState" class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Cancelled Inter-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-warning">{{ ExecutorState.numCancelledInterBrokerPartitionMovements }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">In Progress Inter-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-info">{{ ExecutorState.numInProgressInterBrokerPartitionMovements }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Aborting Inter-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-danger">{{ ExecutorState.numAbortingInterBrokerPartitionMovements }}</h1>
                </div>
              </div>
            </div>
          </div>

          <!-- ===================== INTRA-BROKER SECTION ===================== -->
          <div v-if="isIntraBrokerState || isStoppingState">
            <hr>
            <h4 class="mt-2 mb-3">Intra-Broker Replica Movement Progress</h4>
            <!-- Data movement cards -->
            <div v-if="isIntraBrokerState" class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Total Intra-Broker Data To Move</div>
                <div class="card-body">
                  <div v-if='ExecutorState.totalIntraBrokerDataToMove'>
                    <div class="progress" style="height:20px">
                      <div class="progress-bar progress-bar-striped progress-bar-animated" :style="'width:' + ExecutorState.finishedIntraBrokerDataMovement / ExecutorState.totalIntraBrokerDataToMove * 100 + '%'">Done</div>
                    </div>
                  </div>
                  <h1 class="text-primary">{{ ExecutorState.totalIntraBrokerDataToMove | formatUnits }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Finished Intra-Broker Data Movement</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-success">{{ ExecutorState.finishedIntraBrokerDataMovement | formatUnits }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Remaining Intra-Broker Data</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-info">{{ ExecutorState.totalIntraBrokerDataToMove - ExecutorState.finishedIntraBrokerDataMovement | formatUnits }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">% Data Complete</div>
                <div class="card-body">
                  <h1 class="text-warning">{{ ExecutorState.totalIntraBrokerDataToMove ? (ExecutorState.finishedIntraBrokerDataMovement / ExecutorState.totalIntraBrokerDataToMove * 100).toFixed(1) + '%' : '0%' }}</h1>
                </div>
              </div>
            </div>
            <!-- Partition movement counts -->
            <div v-if="isIntraBrokerState" class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Total Intra-Broker Partition Movements</div>
                <div class="card-body">
                  <div v-if='ExecutorState.numTotalIntraBrokerPartitionMovements'>
                    <div class="progress" style="height:20px">
                      <div class="progress-bar progress-bar-striped bg-success" :style="'width:' + ExecutorState.numFinishedIntraBrokerPartitionMovements / ExecutorState.numTotalIntraBrokerPartitionMovements * 100 + '%'">Done</div>
                      <div class="progress-bar progress-bar-striped progress-bar-animated" :style="'width:' + getInProgressIntraBrokerPartitionMovements.length / ExecutorState.numTotalIntraBrokerPartitionMovements * 100 + '%'">In Progress</div>
                    </div>
                  </div>
                  <h1 class="text-primary">{{ ExecutorState.numTotalIntraBrokerPartitionMovements | formatNumber }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Finished Intra-Broker Partition Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-success">{{ ExecutorState.numFinishedIntraBrokerPartitionMovements | formatNumber }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">In Progress Intra-Broker Partition Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-warning">{{ getInProgressIntraBrokerPartitionMovements.length | formatNumber }}</h1></p>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Remaining Intra-Broker Partition Movements</div>
                <div class="card-body">
                  <p class="card-text"><h1 class="text-info">{{ ExecutorState.numTotalIntraBrokerPartitionMovements - ExecutorState.numFinishedIntraBrokerPartitionMovements | formatNumber }}</h1></p>
                </div>
              </div>
            </div>
            <!-- Intra-broker detailed counts: pending, in-progress, aborting -->
            <div v-if="isIntraBrokerState" class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Pending Intra-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-warning">{{ ExecutorState.numPendingIntraBrokerPartitionMovements }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">In Progress Intra-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-info">{{ ExecutorState.numInProgressIntraBrokerPartitionMovements }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Aborting Intra-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-danger">{{ ExecutorState.numAbortingIntraBrokerPartitionMovements }}</h1>
                </div>
              </div>
            </div>
            <!-- Intra-broker concurrency stats -->
            <div v-if="ExecutorState.maximumConcurrentIntraBrokerPartitionMovementsPerBroker != null" class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Max Concurrent Intra-Broker Movements/Broker</div>
                <div class="card-body">
                  <h1 class="text-primary">{{ ExecutorState.maximumConcurrentIntraBrokerPartitionMovementsPerBroker }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Min Concurrent Intra-Broker Movements/Broker</div>
                <div class="card-body">
                  <h1 class="text-primary">{{ ExecutorState.minimumConcurrentIntraBrokerPartitionMovementsPerBroker }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Avg Concurrent Intra-Broker Movements/Broker</div>
                <div class="card-body">
                  <h1 class="text-primary">{{ ExecutorState.averageConcurrentIntraBrokerPartitionMovementsPerBroker | formatDecimal }}</h1>
                </div>
              </div>
            </div>
            <!-- Stopping state: intra-broker cancelled/in-progress/aborting counts -->
            <div v-if="isStoppingState" class="card-deck mb-3">
              <div class="card">
                <div class="card-header">Cancelled Intra-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-warning">{{ ExecutorState.numCancelledIntraBrokerPartitionMovements }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">In Progress Intra-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-info">{{ ExecutorState.numInProgressIntraBrokerPartitionMovements }}</h1>
                </div>
              </div>
              <div class="card">
                <div class="card-header">Aborting Intra-Broker Movements</div>
                <div class="card-body">
                  <h1 class="text-danger">{{ ExecutorState.numAbortingIntraBrokerPartitionMovements }}</h1>
                </div>
              </div>
            </div>
          </div>

          <!-- ===================== RUNNING REASSIGNMENTS ===================== -->
          <div class="mb-3">
            <h4 class="mt-2 mb-3">Running Reassignments</h4>
            <!-- In-progress inter-broker movements table -->
            <div v-if="(isInterBrokerState || isStoppingState) && getInProgressPartitionMovements.length" class="mb-3">
              <h5>In Progress Inter-Broker Movements ({{ getInProgressPartitionMovements.length }})</h5>
              <table class="table table-sm table-bordered table-striped">
                <thead class="thead-dark">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Old Replica</th>
                    <th>New Replica</th>
                    <th>Movement Type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in getInProgressPartitionMovements" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                    <td>{{ h.proposal.newReplicas.join(',') }}</td>
                    <td>{{ h.type }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- In-progress intra-broker movements table -->
            <div v-if="(isIntraBrokerState || isStoppingState) && getInProgressIntraBrokerPartitionMovements.length" class="mb-3">
              <h5>In Progress Intra-Broker Movements ({{ getInProgressIntraBrokerPartitionMovements.length }})</h5>
              <table class="table table-sm table-bordered table-striped">
                <thead class="thead-dark">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Broker ID</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in getInProgressIntraBrokerPartitionMovements" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.brokerId }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- ===================== MOVEMENT DETAILS (below Running Reassignments) ===================== -->
          <!-- Inter-broker verbose tables (only when not stopping, stopping has its own) -->
          <div v-if="isInterBrokerState">
            <button class="btn btn-sm btn-outline-secondary mb-3" @click="showInterBrokerDetails = !showInterBrokerDetails">
              {{ showInterBrokerDetails ? 'Hide' : 'Show' }} Movement Details
            </button>
            <div v-if="showInterBrokerDetails">
              <div class="card-deck mb-3">
                <h4>Completed Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Old Replica</th>
                      <th>New Replica</th>
                      <th>Movement Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.completedPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                      <td>{{ h.proposal.newReplicas.join(',') }}</td>
                      <td>{{ h.type }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Pending Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Old Replica</th>
                      <th>New Replica</th>
                      <th>Movement Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in getPendingPartitionMovements" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                      <td>{{ h.proposal.newReplicas.join(',') }}</td>
                      <td>{{ h.type }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>In Progress Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Old Replica</th>
                      <th>New Replica</th>
                      <th>Movement Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in getInProgressPartitionMovements" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                      <td>{{ h.proposal.newReplicas.join(',') }}</td>
                      <td>{{ h.type }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Aborting Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Old Replica</th>
                      <th>New Replica</th>
                      <th>Movement Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.abortingPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                      <td>{{ h.proposal.newReplicas.join(',') }}</td>
                      <td>{{ h.type }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Aborted Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Old Replica</th>
                      <th>New Replica</th>
                      <th>Movement Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.abortedPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                      <td>{{ h.proposal.newReplicas.join(',') }}</td>
                      <td>{{ h.type }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Dead partition Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Old Replica</th>
                      <th>New Replica</th>
                      <th>Movement Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.deadPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                      <td>{{ h.proposal.newReplicas.join(',') }}</td>
                      <td>{{ h.type }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <!-- Stopping state: inter-broker verbose tables -->
          <div v-if="isStoppingState">
            <div class="card-deck mb-3" v-if="ExecutorState.cancelledInterBrokerPartitionMovement && ExecutorState.cancelledInterBrokerPartitionMovement.length">
              <h4>Cancelled Inter-Broker Movements</h4>
              <table class="table table-sm table-bordered">
                <thead class="thead-light">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Old Replica</th>
                    <th>New Replica</th>
                    <th>Movement Type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in ExecutorState.cancelledInterBrokerPartitionMovement" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                    <td>{{ h.proposal.newReplicas.join(',') }}</td>
                    <td>{{ h.type }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card-deck mb-3" v-if="ExecutorState.inProgressInterBrokerPartitionMovement && ExecutorState.inProgressInterBrokerPartitionMovement.length">
              <h4>In Progress Inter-Broker Movements</h4>
              <table class="table table-sm table-bordered">
                <thead class="thead-light">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Old Replica</th>
                    <th>New Replica</th>
                    <th>Movement Type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in ExecutorState.inProgressInterBrokerPartitionMovement" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                    <td>{{ h.proposal.newReplicas.join(',') }}</td>
                    <td>{{ h.type }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card-deck mb-3" v-if="ExecutorState.abortingInterBrokerPartitionMovement && ExecutorState.abortingInterBrokerPartitionMovement.length">
              <h4>Aborting Inter-Broker Movements</h4>
              <table class="table table-sm table-bordered">
                <thead class="thead-light">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Old Replica</th>
                    <th>New Replica</th>
                    <th>Movement Type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in ExecutorState.abortingInterBrokerPartitionMovement" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.proposal.oldReplicas.join(',') }}</td>
                    <td>{{ h.proposal.newReplicas.join(',') }}</td>
                    <td>{{ h.type }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <!-- Intra-broker verbose tables (active intra-broker state) -->
          <div v-if="isIntraBrokerState">
            <button class="btn btn-sm btn-outline-secondary mb-3" @click="showIntraBrokerDetails = !showIntraBrokerDetails">
              {{ showIntraBrokerDetails ? 'Hide' : 'Show' }} Intra-Broker Movement Details
            </button>
            <div v-if="showIntraBrokerDetails">
              <div class="card-deck mb-3">
                <h4>Completed Intra-Broker Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Broker ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.completedIntraBrokerPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.brokerId }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Pending Intra-Broker Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Broker ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in getPendingIntraBrokerPartitionMovements" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.brokerId }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>In Progress Intra-Broker Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Broker ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in getInProgressIntraBrokerPartitionMovements" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.brokerId }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Aborting Intra-Broker Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Broker ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.abortingIntraBrokerPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.brokerId }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Aborted Intra-Broker Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Broker ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.abortedIntraBrokerPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.brokerId }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="card-deck mb-3">
                <h4>Dead Intra-Broker Movements</h4>
                <table class="table table-sm table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th>Topic</th>
                      <th>Partition</th>
                      <th>Broker ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(h, idx) in ExecutorState.deadIntraBrokerPartitionMovement" :key="idx">
                      <td>{{ h.proposal.topicPartition.topic }}</td>
                      <td>{{ h.proposal.topicPartition.partition }}</td>
                      <td>{{ h.brokerId }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <!-- Stopping state: intra-broker verbose tables -->
          <div v-if="isStoppingState">
            <div class="card-deck mb-3" v-if="ExecutorState.cancelledIntraBrokerPartitionMovement && ExecutorState.cancelledIntraBrokerPartitionMovement.length">
              <h4>Cancelled Intra-Broker Movements</h4>
              <table class="table table-sm table-bordered">
                <thead class="thead-light">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Broker ID</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in ExecutorState.cancelledIntraBrokerPartitionMovement" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.brokerId }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card-deck mb-3" v-if="ExecutorState.inProgressIntraBrokerPartitionMovement && ExecutorState.inProgressIntraBrokerPartitionMovement.length">
              <h4>In Progress Intra-Broker Movements</h4>
              <table class="table table-sm table-bordered">
                <thead class="thead-light">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Broker ID</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in ExecutorState.inProgressIntraBrokerPartitionMovement" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.brokerId }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card-deck mb-3" v-if="ExecutorState.abortingIntraBrokerPartitionMovement && ExecutorState.abortingIntraBrokerPartitionMovement.length">
              <h4>Aborting Intra-Broker Movements</h4>
              <table class="table table-sm table-bordered">
                <thead class="thead-light">
                  <tr>
                    <th>Topic</th>
                    <th>Partition</th>
                    <th>Broker ID</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, idx) in ExecutorState.abortingIntraBrokerPartitionMovement" :key="idx">
                    <td>{{ h.proposal.topicPartition.topic }}</td>
                    <td>{{ h.proposal.topicPartition.partition }}</td>
                    <td>{{ h.brokerId }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script>
import BooleanEL from '@/components/BooleanEL'

export default {
  name: 'Executor',
  props: {
    group: String,
    cluster: String
  },
  components: {
    BooleanEL
  },
  data () {
    return {
      loaded: false,
      loading: false,
      error: false,
      errorData: null,
      async: false, // when the server treats this request as async
      asyncData: null, // when the server treats the request as async and sends progress instead of actual response
      showTriggeredTaskInfo: false,
      showInterBrokerDetails: false,
      showIntraBrokerDetails: false,
      autoRefresh: true,
      autoRefreshInterval: null,
      asyncRetryTimer: null,
      errStopProsalExecution: false, // true when stop propsal execution is success
      errDataStopProposalExecution: null, // err data of stop proposal execution
      okDataStopProposalExecution: null, // success data from stop proposal execution
      ExecutorState: {
        state: null,
        // Inter-broker fields
        totalDataToMove: 0,
        finishedDataMovement: 0,
        numTotalLeadershipMovements: 0,
        numFinishedLeadershipMovements: 0,
        numTotalPartitionMovements: 0,
        numFinishedPartitionMovements: 0,
        abortingPartitions: 0,
        abortedPartitions: 0,
        deadPartitions: 0,
        numFinishedPartitions: 0,
        numTotalPartitions: 0,
        completedPartitionMovement: [],
        pendingPartitionMovement: [],
        inProgressPartitionMovement: [],
        abortingPartitionMovement: [],
        abortedPartitionMovement: [],
        deadPartitionMovement: [],
        // Inter-broker concurrency
        maximumConcurrentInterBrokerPartitionMovementsPerBroker: null,
        minimumConcurrentInterBrokerPartitionMovementsPerBroker: null,
        averageConcurrentInterBrokerPartitionMovementsPerBroker: null,
        // Inter-broker stopping fields
        numCancelledInterBrokerPartitionMovements: 0,
        numInProgressInterBrokerPartitionMovements: 0,
        numAbortingInterBrokerPartitionMovements: 0,
        cancelledInterBrokerPartitionMovement: [],
        inProgressInterBrokerPartitionMovement: [],
        abortingInterBrokerPartitionMovement: [],
        // Intra-broker fields
        numTotalIntraBrokerPartitionMovements: 0,
        numFinishedIntraBrokerPartitionMovements: 0,
        numPendingIntraBrokerPartitionMovements: 0,
        numInProgressIntraBrokerPartitionMovements: 0,
        numAbortingIntraBrokerPartitionMovements: 0,
        totalIntraBrokerDataToMove: 0,
        finishedIntraBrokerDataMovement: 0,
        // Intra-broker concurrency
        maximumConcurrentIntraBrokerPartitionMovementsPerBroker: null,
        minimumConcurrentIntraBrokerPartitionMovementsPerBroker: null,
        averageConcurrentIntraBrokerPartitionMovementsPerBroker: null,
        // Intra-broker verbose
        completedIntraBrokerPartitionMovement: [],
        pendingIntraBrokerPartitionMovement: [],
        inProgressIntraBrokerPartitionMovement: [],
        abortingIntraBrokerPartitionMovement: [],
        abortedIntraBrokerPartitionMovement: [],
        deadIntraBrokerPartitionMovement: [],
        // Intra-broker stopping fields
        numCancelledIntraBrokerPartitionMovements: 0,
        cancelledIntraBrokerPartitionMovement: [],
        // Triggered task info
        triggeredUserTaskId: null,
        triggeredSelfHealingTaskId: null,
        triggeredTaskReason: null
      }
    }
  },
  created () {
    this.argsChanged()
    this.autoRefreshInterval = setInterval(() => {
      if (!this.loading) {
        this.getState()
      }
    }, 30000)
  },
  beforeDestroy () {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval)
    }
    if (this.asyncRetryTimer) {
      clearTimeout(this.asyncRetryTimer)
    }
  },
  watch: {
    group: function (ogroup, ngroup) {
      this.argsChanged()
    },
    cluster: function (ocluster, ncluster) {
      this.argsChanged()
    }
  },
  computed: {
    hideHelperURL () {
      return this.$store.state.hideHelperURL
    },
    url () {
      return this.$helpers.getURL('state', { substates: 'EXECUTOR', verbose: true })
    },
    stopProposalExecutionURL () {
      return this.$helpers.getURL('stop_proposal_execution')
    },
    isInterBrokerState () {
      return this.ExecutorState.state === 'INTER_BROKER_REPLICA_MOVEMENT_TASK_IN_PROGRESS'
    },
    isIntraBrokerState () {
      return this.ExecutorState.state === 'INTRA_BROKER_REPLICA_MOVEMENT_TASK_IN_PROGRESS'
    },
    isStoppingState () {
      return this.ExecutorState.state === 'STOPPING_EXECUTION'
    },
    isLeaderMovementState () {
      return this.ExecutorState.state === 'LEADER_MOVEMENT_TASK_IN_PROGRESS'
    },
    isInProgressState () {
      return this.isInterBrokerState || this.isIntraBrokerState || this.isStoppingState || this.isLeaderMovementState
    },
    parsedTaskReason () {
      const reason = this.ExecutorState.triggeredTaskReason || ''
      const result = { prefix: '', entries: [] }
      // Format: "Self healing for GOAL_VIOLATION: {key1: val1, key2: val2}"
      const match = reason.match(/^(.*?):\s*\{(.*)\}\s*$/)
      if (!match) return result
      result.prefix = match[1]
      const inner = match[2]
      // Split on top-level commas (not inside braces or parentheses)
      const pairs = []
      let depth = 0
      let current = ''
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i]
        if (ch === '{' || ch === '(') depth++
        else if (ch === '}' || ch === ')') depth--
        else if (ch === ',' && depth === 0) {
          pairs.push(current.trim())
          current = ''
          continue
        }
        current += ch
      }
      if (current.trim()) pairs.push(current.trim())
      for (const pair of pairs) {
        // Find the first top-level colon (not inside parens/braces)
        let d = 0
        let colonIdx = -1
        for (let i = 0; i < pair.length; i++) {
          if (pair[i] === '{' || pair[i] === '(') d++
          else if (pair[i] === '}' || pair[i] === ')') d--
          else if (pair[i] === ':' && d === 0) { colonIdx = i; break }
        }
        if (colonIdx > 0) {
          result.entries.push({
            key: pair.substring(0, colonIdx).trim(),
            value: pair.substring(colonIdx + 1).trim()
          })
        } else if (pair) {
          result.entries.push({ key: pair, value: '' })
        }
      }
      return result
    },
    getPendingPartitionMovements () {
      if (typeof this.ExecutorState.pendingPartitionMovement === 'undefined') {
        return []
      } else {
        return this.ExecutorState.pendingPartitionMovement.filter(f => f.state === 'PENDING')
      }
    },
    getInProgressPartitionMovements () {
      let inprogress = []
      let pending = []
      if (typeof this.ExecutorState.inProgressPartitionMovement !== 'undefined') {
        inprogress = this.ExecutorState.inProgressPartitionMovement
      }
      if (typeof this.ExecutorState.pendingPartitionMovement !== 'undefined') {
        pending = this.ExecutorState.pendingPartitionMovement
      }
      return inprogress.concat(pending.filter(f => f.state === 'IN_PROGRESS'))
    },
    getPendingIntraBrokerPartitionMovements () {
      if (typeof this.ExecutorState.pendingIntraBrokerPartitionMovement === 'undefined') {
        return []
      } else {
        return this.ExecutorState.pendingIntraBrokerPartitionMovement.filter(f => f.state === 'PENDING')
      }
    },
    getInProgressIntraBrokerPartitionMovements () {
      let inprogress = []
      let pending = []
      if (typeof this.ExecutorState.inProgressIntraBrokerPartitionMovement !== 'undefined') {
        inprogress = this.ExecutorState.inProgressIntraBrokerPartitionMovement
      }
      if (typeof this.ExecutorState.pendingIntraBrokerPartitionMovement !== 'undefined') {
        pending = this.ExecutorState.pendingIntraBrokerPartitionMovement
      }
      return inprogress.concat(pending.filter(f => f.state === 'IN_PROGRESS'))
    }
  },
  methods: {
    argsChanged (retries) {
      retries = retries || 0
      const newurl = this.$store.getters.getnewurl(this.group, this.cluster)
      if (!newurl) {
        if (retries < 20) {
          setTimeout(() => this.argsChanged(retries + 1), 500)
        }
        return
      }
      this.$store.commit('seturl', newurl)
      this.loaded = false
      if (this.autoRefreshInterval) {
        clearInterval(this.autoRefreshInterval)
        this.autoRefreshInterval = null
        this.autoRefresh = false
      }
      if (this.asyncRetryTimer) {
        clearTimeout(this.asyncRetryTimer)
        this.asyncRetryTimer = null
      }
      this.getState()
    },
    getState () {
      const vm = this
      vm.loading = true
      // Use fetch with credentials:'omit' to prevent session cookie from being sent.
      // CC's UserTaskManager maps session cookies to old user tasks, causing stale responses.
      window.fetch(vm.url, { credentials: 'omit' }).then((resp) => {
        const contentType = resp.headers.get('content-type') || ''
        return resp.text().then((text) => ({ text, contentType, ok: resp.ok, status: resp.status }))
      }).then((resp) => {
        let data
        try { data = JSON.parse(resp.text) } catch (e) { data = resp.text }
        if (data === null || data === undefined || data === '') {
          vm.loading = false
          vm.error = true
          vm.errorData = 'CruiseControl sent an empty response with ' + resp.status + ' status code.'
        } else if (resp.contentType.match(/text\/plain/) || (data && data.progress)) {
          vm.loading = false
          vm.async = true
          vm.asyncData = data
          if (vm.asyncRetryTimer) clearTimeout(vm.asyncRetryTimer)
          vm.asyncRetryTimer = setTimeout(() => vm.getState(), 5000)
        } else if (!resp.ok) {
          if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
          vm.loading = false
          vm.error = true
          vm.errorData = data
        } else {
          if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
          vm.async = false
          vm.error = false
          vm.errorData = null
          vm.loading = false
          vm.$set(vm, 'ExecutorState', Object.assign(JSON.parse(JSON.stringify(vm.$options.data.call(vm).ExecutorState)), data.ExecutorState))
          vm.loaded = true
        }
      }).catch((e) => {
        if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
        vm.loading = false
        vm.error = true
        vm.errorData = e.message || e
      })
    },
    toggleAutoRefresh () {
      if (this.autoRefresh) {
        clearInterval(this.autoRefreshInterval)
        this.autoRefreshInterval = null
        this.autoRefresh = false
      } else {
        this.autoRefresh = true
        this.autoRefreshInterval = setInterval(() => {
          if (!this.loading) {
            this.getState()
          }
        }, 30000)
      }
    },
    stopProposalExecution () {
      const vm = this
      // cancel the on-going proposal execution
      vm.$http.post(this.stopProposalExecutionURL, { withCredentials: true }).then((r) => {
        vm.errStopProsalExecution = false
        vm.okDataStopProposalExecution = r.data
      }, (e) => {
        vm.errStopProsalExecution = true
        vm.errDataStopProposalExecution = e && e.response ? e.response.data : e
      })
    }
  }
}
</script>

<style scoped>
.card-columns {
  column-count: 6;
}
.fade-enter-active, .fade-leave-active {
  transition: opacity .5s
}
.fade-enter, .fade-leave-to  {
  opacity: 0
}

</style>
