<!-- Copyright 2017-2019 LinkedIn Corp. Licensed under the BSD 2-Clause License (the "License"). See License in the project root for license information. -->
<template>
  <div>
    <div class="alert alert-info" v-if='!hideHelperURL'>
      <b>URL ({{group}}, {{cluster}}):</b> <a target=_blank :href='url'>{{ url }}</a>
    </div>
    <div v-if='!loading && !detectedUserTaskId' class='alert alert-danger'>
      <strong>User-Task-ID</strong> header is not found in the response from the server. If you are using <a target=_blank href='https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'>CORS</a>, please add necessary configuration to your Cruise Control as described <a target=_blank href='https://github.com/linkedin/cruise-control-ui/wiki/CORS-Method'>in this wiki.</a>
    </div>
    <div v-if='!loading'>
      <div class="alert alert-primary">
        <b>Flags: </b>
        <label>Allow Capacity Estimation:</label> <input type=checkbox v-model=allow_capacity_estimation>
        <button class="btn btn-primary float-right" @click='getLoad()'>Refresh Kafka Cluster Load</button>
      </div>
    </div>
    <div v-if='error'>
      <exception :exception='errorData'></exception>
    </div>
    <div v-else-if='async'>
      <div class="alert alert-info text-center" v-if='showAsyncRefreshButton'>
        <button class="btn btn-sm btn-secondary" @click='getProposals()'>⟳ Refresh View Now (Task-Id: {{ taskId }} )</button>
      </div>
      <async-task :asyncData='asyncData'></async-task>
    </div>
    <div v-else-if='!loaded && loading'>
      <div class="text-center p-3"><div class="spinner-border text-primary" role="status"></div> Loading ...</div>
    </div>
    <div v-else>
      <host-load :hosts='hosts' :loading='loading' :error='error' :errorData='errorData'></host-load>
      <br>
      <broker-load :brokers='brokers' :loading='loading' :error='error' :errorData='errorData'></broker-load>
    </div>
  </div>
</template>

<script>
import HostLoad from '@/components/HostLoad'
import BrokerLoad from '@/components/BrokerLoad'

export default {
  name: 'Load',
  props: {
    group: String,
    cluster: String,
    rawdata: Object
  },
  data () {
    return {
      loading: false,
      loaded: false,
      error: false,
      errorData: null,
      async: false,
      asyncData: null,
      asyncRetryTimer: null,
      // params
      allow_capacity_estimation: true,
      // broker load & host load
      brokers: [],
      hosts: [],
      detectedUserTaskId: false // true in case the response has user-task-id
    }
  },
  created () {
    if (this.rawdata) {
      this.brokers = this.rawdata.brokers
      this.hosts = this.rawdata.hosts
    } else {
      this.getLoad(true)
    }
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
    url () {
      // KCC Supports additional parameters as well.
      // time=[TIMESTAMP]
      // allow_capacity_estimation=[true/false]
      let params = {
        allow_capacity_estimation: this.allow_capacity_estimation
      }
      return this.$helpers.getURL('load', params)
    },
    hideHelperURL () {
      return this.$store.state.hideHelperURL
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
      this.newurl = newurl
      if (this.asyncRetryTimer) {
        clearTimeout(this.asyncRetryTimer)
        this.asyncRetryTimer = null
      }
      this.getLoad()
    },
    getLoad () {
      let vm = this
      vm.error = false
      vm.async = false
      vm.loading = true
      let fetchOptions = {
        credentials: 'omit'
      }
      // check if there is a running user-task-id for this end point in the $store
      // let task = this.$store.getters.getTaskId('proposals')
      let task = this.$store.getters.getTaskId(vm.url)
      if (task) {
        fetchOptions.headers = {
          'User-Task-ID': task
        }
      }
      window.fetch(vm.url, fetchOptions).then((resp) => {
        let contentType = resp.headers.get('content-type') || ''
        let detectedUserTaskId = resp.headers.has('user-task-id')
        let userTaskId = resp.headers.get('user-task-id')
        return resp.text().then((text) => {
          return { ok: resp.ok, status: resp.status, contentType, detectedUserTaskId, userTaskId, text }
        })
      }).then((resp) => {
        // set this so that we know if the server sends user-task-id in the response
        vm.detectedUserTaskId = resp.detectedUserTaskId
        if (!resp.ok) {
          vm.loading = false
          vm.error = true
          vm.errorData = resp.text
          return
        }
        // check the actual response
        let data = null
        try { data = JSON.parse(resp.text) } catch (e) { data = resp.text }
        if (data === null || data === undefined || data === '') {
          vm.error = true
          vm.errorData = 'CruiseControl sent an empty response with 200-OK status code. Please file a bug here https://github.com/linkedin/cruise-control/issues'
        } else if (resp.contentType.match(/text\/plain/) || data.progress) {
          // capture the user-task-id only if the response is Async one
          let task = resp.detectedUserTaskId ? resp.userTaskId : null
          vm.$store.commit('setTaskId', {url: vm.url, taskid: task}) // save this task for follow-up calls (null deletes in vuex)
          vm.async = true
          vm.asyncData = data
          vm.showAsyncRefreshButton = true
          if (vm.asyncRetryTimer) clearTimeout(vm.asyncRetryTimer)
          vm.asyncRetryTimer = setTimeout(() => vm.getLoad(), 5000)
        } else {
          if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
          vm.async = false
          vm.loading = false
          vm.loaded = true
          vm.error = false
          vm.errorData = null
          vm.brokers = data.brokers || []
          vm.hosts = data.hosts || []
        }
      }).catch((e) => {
        if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
        vm.loading = false
        vm.error = true
        vm.errorData = e
      })
    }
  },
  components: {
    BrokerLoad,
    HostLoad
  }
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity .5s
}
.fade-enter, .fade-leave-to  {
  opacity: 0
}
</style>
