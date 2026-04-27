<!-- Copyright 2017-2019 LinkedIn Corp. Licensed under the BSD 2-Clause License (the "License"). See License in the project root for license information. -->
<template>
  <div>
    <div class="alert alert-info" v-if='!hideHelperURL'>
      <b>URL ({{group}}, {{cluster}}):</b> <a target=_blank :href='url'>{{ url }}</a>
    </div>
    <div v-if='!loading && !detectedUserTaskId' class='alert alert-danger'>
      <strong>User-Task-ID</strong> header is not found in the response from the server. If you are using <a target=_blank href='https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'>CORS</a>, please add necessary configuration to your Cruise Control as described <a target=_blank href='https://github.com/linkedin/cruise-control-ui/wiki/CORS-Method'>in this wiki.</a>
    </div>
    <div v-if='error'>
      <exception :exception='errorData'></exception>
    </div>
    <div v-if='async'>
      <div class="alert alert-info text-center" v-if='showAsyncRefreshButton'>
        <button class="btn btn-sm btn-secondary" @click='getProposals()'>⟳ Refresh View Now (Task-Id: {{ taskId }} )</button>
      </div>
      <async-task :asyncData='asyncData'></async-task>
    </div>
    <div v-if='loading'>
      <div class="text-center p-3"><div class="spinner-border text-primary" role="status"></div> Loading ...</div>
    </div>
    <div v-else-if='loaded'>
      <div class="alert alert-info">
        <b>Help:</b>This page shows the state of the kafka cluster based on the optimized load calculation. Values before and after optimized load are shown respectively.
      </div>

      <h4>Proposal Changes</h4>
      <table class="table table-sm table-bordered">
        <thead class="thead-light">
          <tr>
            <th>Number of Replica Movements</th>
            <th>Number of Leader Movements</th>
            <th>Recent Windows</th>
            <th>Data to Move</th>
            <th>Monitored Partitions Coverage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ numReplicaMovements }}</td>
            <td>{{ numLeaderMovements }}</td>
            <td>{{ recentWindows }}</td>
            <td>{{ dataToMoveMB | formatUnits }}</td>
            <td>{{ monitoredPartitionsPercentage ? monitoredPartitionsPercentage.toFixed(2) : null }}%</td>
          </tr>
        </tbody>
      </table>

      <h4 class="pointer" @click="showBrokerLoad = !showBrokerLoad">
        Optimized Load Difference - Per Broker
        <small class="text-muted">{{ showBrokerLoad ? '(click to hide)' : '(click to show)' }}</small>
      </h4>
      <table v-if="showBrokerLoad" class="table table-sm table-bordered">
        <thead class="thead-light">
          <tr>
            <th>Broker ID</th>
            <th v-for="h in brokerLoad.heading" :key="'bh-'+h">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(brokerdata, brokerid) in brokerLoad.records" :key="brokerid">
            <th>{{ brokerid }}</th>
            <td v-for="h in brokerLoad.heading" :key="'bd-'+h">
              <diff-cell :head='h' :cell='brokerdata[h]' :showpct='showpct' />
            </td>
          </tr>
        </tbody>
      </table>

      <h4 class="pointer" @click="showHostLoad = !showHostLoad">
        Optimized Load Difference - Per Host
        <small class="text-muted">{{ showHostLoad ? '(click to hide)' : '(click to show)' }}</small>
      </h4>
      <table v-if="showHostLoad" class="table table-sm table-bordered">
        <thead class="thead-light">
          <tr>
            <!-- <th>Host</th> -->
            <th v-for="h in hostLoad.heading" :key="'hh-'+h">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(hostdata, host) in hostLoad.records" :key="host">
            <!-- <th>{{ host }}</th> -->
            <td v-for="h in hostLoad.heading" :key="'hd-'+h">
              <diff-cell :head='h' :cell='hostdata[h]' :showpct='showpct' />
            </td>
          </tr>
        </tbody>
      </table>

      <h4 class="pointer" @click="showGoals = !showGoals">
        Goals
        <small class="text-muted">{{ showGoals ? '(click to hide)' : '(click to show)' }}</small>
      </h4>
      <table v-if="showGoals" class="table table-sm table-bordered">
        <thead class="thead-light">
          <tr>
            <th>Goal &amp; Goal Violation Details</th>
            <th>Metadata</th>
          </tr>
        </thead>
        <tbody>
          <tr :key='goal.goal' v-for='goal in goals'>
            <td>
              <strong>{{ goal.goal }}</strong>
              <br>
              <!-- property renamed from goalViolated -> status upstream -->
              <span v-if='goal.hasOwnProperty("goalViolated")'>{{ goal.goalViolated }}</span>
              <span v-else>{{ goal.status }}</span>
            </td>
            <td>
              <goal :goal='goal' />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import DiffCell from '@/components/DiffCell'
import Goal from '@/components/Goal'

export default {
  name: 'Proposals',
  props: {
    'group': String,
    'cluster': String
  },
  components: {
    DiffCell,
    Goal
  },
  data () {
    return {
      loading: false,
      loadingSecondsNow: 0,
      loaded: false,
      error: false,
      errorData: null,
      async: false,
      asyncData: null,
      asyncRetryTimer: null,
      // top level medatadata
      numReplicaMovements: null,
      recentWindows: null,
      dataToMoveMB: null,
      monitoredPartitionsPercentage: null,
      numLeaderMovements: null,
      // optimized data
      loadBefore: {},
      loadAfter: {},
      goals: {},
      // show percentage diff
      showpct: false,
      showBrokerLoad: true,
      showHostLoad: true,
      showGoals: true,
      showAsyncRefreshButton: false,
      detectedUserTaskId: false // true in case the response has user-task-id
    }
  },
  created () {
    this.getProposals()
  },
  beforeDestroy () {
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
    taskId () {
      return this.$store.getters.getTaskId(this.url)
    },
    hideHelperURL () {
      return this.$store.state.hideHelperURL
    },
    loadingSeconds () {
      if (this.loading) {
        this.loadingSecondsNow++
      } else {
        this.loadingSecondsNow = 0
      }
    },
    violatedGoals () {
      let newgoals = []
      this.goals.forEach((g) => {
        if (g.goalViolated.match(/VIOLATED/i)) {
          newgoals.push(g)
        }
      })
      return newgoals
    },
    url () {
      // loadBeforeOptimization is removed and is available only when
      // we pass verbose=true flag
      return this.$helpers.getURL('proposals', {verbose: true})
    },
    hostLoad () {
      let hostMap = [
        {}, // before load
        {} // after load
      ]
      let unified = {}
      if (!this.loadBefore.brokers || !this.loadAfter.brokers) return {'heading': [], 'records': []}
      // re-key them based on the broker-id
      let hostnames = []
      this.loadBefore.hosts.forEach((rec) => {
        hostnames.push(rec.Host)
        hostMap[0][rec.Host] = rec
      })
      this.loadAfter.hosts.forEach((rec) => {
        hostMap[1][rec.Host] = rec
      })
      let numKeys = [
        'FollowerNwInRate',
        'Leaders',
        'DiskMB',
        'PnwOutRate',
        'NwOutRate', // was NnwOutRate
        'CpuPct',
        'Replicas',
        'LeaderNwInRate'
      ]
      let strKeys = [
        'Host'
      ]
      let allKeys = strKeys
      allKeys.push(numKeys)
      allKeys = allKeys.reduce((acc, val) => acc.concat(val), [])
      hostnames.forEach((host) => {
        let diff = {}
        numKeys.forEach((key) => {
          diff[key] = {
            before: hostMap[0][host][key],
            after: hostMap[1][host][key],
            diff: hostMap[0][host][key] - hostMap[1][host][key]
          }
        })
        strKeys.forEach((key) => {
          diff[key] = {
            before: hostMap[0][host][key],
            after: hostMap[1][host][key],
            diff: null
          }
        })
        unified[host] = diff
      })
      return {
        'heading': allKeys,
        'records': unified
      }
    },
    brokerLoad () {
      let brokerMap = [
        {}, // before load
        {} // after load
      ]
      let unified = {}
      if (!this.loadBefore.brokers || !this.loadAfter.brokers) return {'heading': [], 'records': []}
      // re-key them based on the broker-id
      let brokerids = []
      this.loadBefore.brokers.forEach((rec) => {
        brokerids.push(rec.Broker)
        brokerMap[0][rec.Broker] = rec
      })
      this.loadAfter.brokers.forEach((rec) => {
        brokerMap[1][rec.Broker] = rec
      })
      let numKeys = [
        'FollowerNwInRate',
        'Leaders',
        'DiskMB',
        'PnwOutRate',
        'NwOutRate', // was NnwOutRate
        'CpuPct',
        'Replicas',
        'LeaderNwInRate'
      ]
      let strKeys = [
        'BrokerState',
        'Host'
      ]
      let allKeys = strKeys
      allKeys.push(numKeys)
      allKeys = allKeys.reduce((acc, val) => acc.concat(val), [])
      brokerids.forEach((broker) => {
        let diff = {}
        numKeys.forEach((key) => {
          diff[key] = {
            before: brokerMap[0][broker][key],
            after: brokerMap[1][broker][key],
            diff: brokerMap[0][broker][key] - brokerMap[1][broker][key]
          }
        })
        strKeys.forEach((key) => {
          diff[key] = {
            before: brokerMap[0][broker][key],
            after: brokerMap[1][broker][key],
            diff: null
          }
        })
        unified[broker] = diff
      })
      return {
        'heading': allKeys,
        'records': unified
      }
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
      if (this.asyncRetryTimer) {
        clearTimeout(this.asyncRetryTimer)
        this.asyncRetryTimer = null
      }
      this.getProposals()
    },
    getProposals () {
      let vm = this
      vm.error = false
      vm.async = false
      vm.loading = true
      let fetchOptions = {
        credentials: 'omit'
      }
      // check if there is a running user-task-id for this end point in the $store
      let task = this.taskId
      if (task) {
        fetchOptions['headers'] = {
          'User-Task-ID': task
        }
      }
      window.fetch(vm.url, fetchOptions).then((resp) => {
        let contentType = resp.headers.get('content-type') || ''
        return resp.text().then((text) => {
          return { text: text, contentType: contentType, ok: resp.ok, status: resp.status, headers: resp.headers }
        })
      }).then((resp) => {
        vm.loading = false
        // set this so that we know if the server sends user-task-id in the response
        vm.detectedUserTaskId = resp.headers.has('user-task-id')
        let data = null
        try {
          data = JSON.parse(resp.text)
        } catch (e) {
          data = resp.text
        }
        if (data === null || data === undefined || data === '') {
          vm.error = true
          vm.errorData = 'CruiseControl sent an empty response with 200-OK status code. Please file a bug here https://github.com/linkedin/cruise-control/issues'
        } else if (resp.contentType.match(/text\/plain/) || data.progress) {
          // save the task-id if its present in the response header
          let task = resp.headers.has('user-task-id') ? resp.headers.get('user-task-id') : null
          vm.$store.commit('setTaskId', {url: vm.url, taskid: task}) // save this task for follow-up calls (null deletes in vuex)
          // set the internal bits
          vm.async = true
          vm.asyncData = data
          vm.showAsyncRefreshButton = true
          if (vm.asyncRetryTimer) clearTimeout(vm.asyncRetryTimer)
          vm.asyncRetryTimer = setTimeout(() => vm.getProposals(), 5000)
        } else {
          if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
          vm.async = false
          vm.loading = false
          vm.error = false
          // top level metadata in the response
          vm.numReplicaMovements = data.summary.numReplicaMovements
          vm.recentWindows = data.summary.recentWindows
          vm.dataToMoveMB = data.summary.dataToMoveMB
          vm.monitoredPartitionsPercentage = data.summary.monitoredPartitionsPercentage
          vm.numLeaderMovements = data.summary.numLeaderMovements
          // nested maps
          vm.$set(vm, 'loadBefore', data.loadBeforeOptimization)
          vm.$set(vm, 'loadAfter', data.loadAfterOptimization)
          // key has been renamed upstream
          if (data.hasOwnProperty('goalSummary')) {
            vm.$set(vm, 'goals', data.goalSummary)
          } else {
            vm.$set(vm, 'goals', data.goals)
          }
          vm.errorData = null
          vm.loaded = true
        }
      }).catch((e) => {
        if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
        vm.error = true
        vm.loading = false
        vm.goals = []
        vm.errorData = e.message || e
      })
    }
  }
}
</script>

<style scoped>
.pointer { cursor: pointer; }
</style>
